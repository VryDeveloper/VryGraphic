import type { Request } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { AppError } from './errors';

/** Id do usuário logado. Só existe depois do `authenticate`. */
export function uid(req: Request): string {
  if (!req.userId) throw new AppError(401, 'NO_TOKEN', 'Entre para continuar');
  return req.userId;
}

/** Valida a query string (?month=...) com Zod. */
export function parseQuery<S extends ZodTypeAny>(schema: S, req: Request): z.output<S> {
  return schema.parse(req.query);
}

/** BigInt do banco → number na resposta. Centavos cabem com folga em 2^53. */
export const num = (v: bigint | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
export const cents = (v: bigint): number => Number(v);

/** 404 genérico: não revela se o recurso existe e é de outra pessoa. */
export const notFound = (what = 'Registro') => new AppError(404, 'NOT_FOUND', `${what} não encontrado`);

/** 422 quando o corpo é válido mas aponta para algo que não existe (conta/categoria de outro usuário etc.). */
export const badReference = (field: string, message: string) =>
  new AppError(422, 'INVALID_REFERENCE', message, { [field]: message });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `router.param('id', uuidParam)`: id malformado vira 404 em vez de erro do banco. */
export const uuidParam = (_req: Request, _res: unknown, next: (e?: unknown) => void, value: string) =>
  next(UUID.test(value) ? undefined : notFound());
