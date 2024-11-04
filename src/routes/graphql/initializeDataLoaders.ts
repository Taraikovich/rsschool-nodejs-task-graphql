import { MemberType, PrismaClient, User } from '@prisma/client';
import DataLoader from 'dataloader';

const collectBy = <ItemType>(
  items: ItemType[],
  keySelector: (item: ItemType) => string,
) =>
  items.reduce<Record<string, ItemType[]>>((accumulator, currentItem) => {
    const key = keySelector(currentItem);
    const group = accumulator[key] || [];
    group.push(currentItem);
    return { ...accumulator, [key]: group };
  }, {});

export const indexBy = <ItemType>(
  items: ItemType[],
  keySelector: (item: ItemType) => string,
) => Object.fromEntries(items.map((item) => [keySelector(item), item]));

export const initializeDataLoaders = (dbClient: PrismaClient) => ({
  fetchProfilesByUserId: new DataLoader(async (ids: ReadonlyArray<User['id']>) => {
    const foundProfiles = await dbClient.profile.findMany({
      where: { userId: { in: [...ids] } },
    });
    const profilesIndexedByUser = indexBy(foundProfiles, (profile) => profile.userId);
    return ids.map((userId) => profilesIndexedByUser[userId]);
  }),

  fetchSubscriptionsToUser: new DataLoader(async (ids: ReadonlyArray<User['id']>) => {
    const usersWithSubscriptions = await dbClient.user.findMany({
      where: { id: { in: [...ids] } },
      include: { subscribedToUser: { select: { subscriber: true } } },
    });

    const subscriptionsGroupedByUser = collectBy(
      usersWithSubscriptions,
      (user) => user.id,
    );

    return ids.map(
      (userId) =>
        subscriptionsGroupedByUser[userId]?.flatMap((record) =>
          record.subscribedToUser.map((sub) => sub.subscriber),
        ) ?? [],
    );
  }),
  fetchUserSubscriptions: new DataLoader(async (ids: ReadonlyArray<User['id']>) => {
    const usersWithSubscribers = await dbClient.user.findMany({
      where: { id: { in: [...ids] } },
      include: { userSubscribedTo: { select: { author: true } } },
    });

    const subscribersGroupedByUser = collectBy(usersWithSubscribers, (user) => user.id);

    return ids.map(
      (userId) =>
        subscribersGroupedByUser[userId]?.flatMap((record) =>
          record.userSubscribedTo.map((subscription) => subscription.author),
        ) ?? [],
    );
  }),

  fetchUsersById: new DataLoader(async (ids: ReadonlyArray<User['id']>) => {
    const foundUsers = await dbClient.user.findMany({ where: { id: { in: [...ids] } } });
    const usersIndexedById = indexBy(foundUsers, (user) => user.id);
    return ids.map((userId) => usersIndexedById[userId]);
  }),

  fetchPostsByUserId: new DataLoader(async (ids: ReadonlyArray<User['id']>) => {
    const foundPosts = await dbClient.post.findMany({
      where: { authorId: { in: [...ids] } },
    });
    const postsGroupedByUser = collectBy(foundPosts, (post) => post.authorId);
    return ids.map((userId) => postsGroupedByUser[userId] ?? []);
  }),

  fetchMemberTypesById: new DataLoader(async (ids: ReadonlyArray<MemberType['id']>) => {
    const foundMemberTypes = await dbClient.memberType.findMany({
      where: { id: { in: [...ids] } },
    });
    const memberTypesIndexedById = indexBy(foundMemberTypes, (mt) => mt.id);
    return ids.map((id) => memberTypesIndexedById[id]);
  })
});
