import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError, type ZodSchema } from 'zod';

/** Erro de negócio com status HTTP e código estável para o front. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** Valida req.body com um schema Zod e substitui pelo valor limpo. */
export function validateBody(schema: ZodSchema): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}

/** Formato único de erro: { error: { code, message, fields? } }. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join('.') || '_'] = i.message;
    res.status(400).json({ error: { code: 'VALIDATION', message: 'Dados inválidos', fields } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Erro interno do servidor' } });
};

/** Envolve handlers assíncronos para que erros cheguem ao errorHandler (Express 4). */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
