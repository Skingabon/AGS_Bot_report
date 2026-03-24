import { Context } from 'grammy';

export const isHasAccess = (ctx: Context) => {
  const accessIDs = [245848499, 6210941994];
  if (!ctx.from?.id) return false;

  return accessIDs.includes(ctx.from?.id);
};
