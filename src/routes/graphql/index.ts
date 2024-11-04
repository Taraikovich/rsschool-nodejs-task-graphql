import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Post, Profile, PrismaClient, User } from '@prisma/client';
import { simplify, parseResolveInfo, ResolveTree } from 'graphql-parse-resolve-info';
import { createGqlResponseSchema, gqlResponseSchema } from './schemas.js';
import {
  graphql,
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse,
  validate,
} from 'graphql';
import { UUIDType } from './types/uuid.js';
import { initializeDataLoaders, indexBy } from './initializeDataLoaders.js';
import depthLimit from 'graphql-depth-limit';
export type Context = { prisma: PrismaClient } & ReturnType<typeof initializeDataLoaders>;

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
  const typeMembersID = new GraphQLEnumType({
    name: 'MemberTypeId',
    values: {
      basic: { value: 'basic' },
      business: { value: 'business' },
    },
  });

  const typeMembers = new GraphQLObjectType({
    name: 'MemberType',
    fields: () => ({
      id: {
        type: new GraphQLNonNull(typeMembersID),
      },
      discount: {
        type: new GraphQLNonNull(GraphQLFloat),
      },
      postsLimitPerMonth: {
        type: new GraphQLNonNull(GraphQLInt),
      },
    }),
  });

  const typePost = new GraphQLObjectType<Post, Context>({
    name: 'Post',
    fields: () => ({
      id: {
        type: new GraphQLNonNull(UUIDType),
      },
      title: {
        type: new GraphQLNonNull(GraphQLString),
      },
      content: {
        type: new GraphQLNonNull(GraphQLString),
      },
      author: {
        type: new GraphQLNonNull(typePerson),
        resolve: async (p, _, ctx) => ctx.fetchUsersById.load(p.authorId),
      },
    }),
  });

  const typeProfile = new GraphQLObjectType<Profile, Context>({
    name: 'Profile',
    fields: () => ({
      id: {
        type: new GraphQLNonNull(UUIDType),
      },
      isMale: {
        type: new GraphQLNonNull(GraphQLBoolean),
      },
      yearOfBirth: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      memberType: {
        type: new GraphQLNonNull(typeMembers),
        resolve: (profile, _args, ctx) =>
          ctx.fetchMemberTypesById.load(profile.memberTypeId),
      },
      user: {
        type: new GraphQLNonNull(typePerson),
        resolve: (profile, _args, ctx) => ctx.fetchUsersById.load(profile.userId),
      },
    }),
  });

  const typePerson = new GraphQLObjectType<User, Context>({
    name: 'User',
    fields: () => ({
      id: { type: new GraphQLNonNull(UUIDType) },
      name: { type: new GraphQLNonNull(GraphQLString) },
      balance: { type: new GraphQLNonNull(GraphQLFloat) },
      posts: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(typePost))),
        resolve: (user, _, ctx: Context) => ctx.fetchPostsByUserId.load(user.id),
      },
      profile: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        type: typeProfile,
        resolve: (user, _, ctx: Context) => ctx.fetchProfilesByUserId.load(user.id),
      },
      subscribedToUser: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(typePerson))),
        resolve: (user, _, ctx: Context) => ctx.fetchSubscriptionsToUser.load(user.id),
      },
      userSubscribedTo: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(typePerson))),
        resolve: (user, _, ctx: Context) => ctx.fetchUserSubscriptions.load(user.id),
      },
    }),
  });

  const RootQuery = new GraphQLObjectType<unknown, Context>({
    name: 'RootQuery',
    fields: () => ({
      memberTypes: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(typeMembers))),
        resolve: async (_, _args, ctx: Context) => {
          return ctx.prisma.memberType.findMany();
        },
      },
      memberType: {
        type: new GraphQLNonNull(typeMembers),
        args: {
          id: { type: new GraphQLNonNull(typeMembersID) },
        },
        resolve: async (_, { id }, ctx: Context) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          return ctx.prisma.memberType.findUnique({ where: { id } });
        },
      },

      posts: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(typePost))),

        resolve: async (_, _args, ctx: Context) => {
          return ctx.prisma.post.findMany();
        },
      },
      post: {
        type: typePost as GraphQLObjectType,

        args: {
          id: { type: new GraphQLNonNull(UUIDType) },
        },
        resolve: async (_, { id }, ctx: Context) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          return ctx.prisma.post.findUnique({ where: { id } });
        },
      },

      users: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(typePerson))),
        resolve: async (_source, _args, ctx: Context, info) => {
          const parsedInfo = parseResolveInfo(info);

          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          const { fields } = simplify(parsedInfo as ResolveTree, typePerson);

          const needsSubscriptions = 'subscribedToUser' in fields;

          const needsFollowers = 'userSubscribedTo' in fields;

          const users = await ctx.prisma.user.findMany({
            include: {
              subscribedToUser: needsSubscriptions,
              userSubscribedTo: needsFollowers,
            },
          });

          if (needsSubscriptions || needsFollowers) {
            const usersMap = indexBy(users, (user) => user.id);

            users.forEach((user) => {
              if (needsSubscriptions) {
                ctx.fetchSubscriptionsToUser.prime(
                  user.id,
                  user.subscribedToUser.map(
                    (relation) => usersMap[relation.subscriberId],
                  ),
                );
              }
              if (needsFollowers) {
                ctx.fetchUserSubscriptions.prime(
                  user.id,
                  user.userSubscribedTo.map((relation) => usersMap[relation.authorId]),
                );
              }
            });
          }

          return users;
        },
      },
      user: {
        type: typePerson as GraphQLObjectType,

        args: { id: { type: new GraphQLNonNull(UUIDType) } },

        resolve: async (_, { id }, ctx: Context) =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          ctx.prisma.user.findUnique({ where: { id } }),
      },

      profiles: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(typeProfile))),

        resolve: async (_, _arg, ctx: Context) => {
          return ctx.prisma.profile.findMany();
        },
      },
      profile: {
        type: typeProfile as GraphQLObjectType,
        args: { id: { type: new GraphQLNonNull(UUIDType) } },
        resolve: async (_, { id }, ctx: Context) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          return ctx.prisma.profile.findUnique({ where: { id } });
        },
      },
    }),
  });

  const schema = new GraphQLSchema({
    query: RootQuery,
  });

  fastify.route({
    url: '/',
    method: 'POST',
    schema: {
      ...createGqlResponseSchema,
      response: {
        200: gqlResponseSchema,
      },
    },
    async handler(req) {
      const { query, variables } = req.body;

      const depthFiveDepthError = validate(schema, parse(query), [depthLimit(5)]);

      if (depthFiveDepthError.length) {
        return { data: null, errors: depthFiveDepthError };
      }
      const { prisma } = fastify;
      return await graphql({
        schema,
        source: query,
        variableValues: variables,
        contextValue: { prisma, ...initializeDataLoaders(prisma) },
      });
    },
  });
};

export default plugin;
