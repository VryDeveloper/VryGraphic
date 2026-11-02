import { PrismaClient } from '@prisma/client';

/** Um único PrismaClient por processo (o watch do tsx recria o módulo, então guardamos no global). */
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;

/** BigInt não existe em JSON: valores em centavos saem como string ("-12050"). */
declare global {
  interface BigInt {
    toJSON(): string;
  }
}
BigInt.prototype.toJSON = function () {
  return this.toString();
};
