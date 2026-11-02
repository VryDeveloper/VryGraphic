import { Router } from 'express';
import { commandSchema, demoCommandContext, ISSUE_MESSAGES, parseCommand } from '@vrygraphic/shared';
import { validateBody } from '../../lib/errors';

/**
 * Fase 1: prévia do comando com as categorias e contas padrão.
 * Na fase 3, `POST /transactions/command` usa as categorias e contas do usuário logado
 * e grava o lançamento (ou as N parcelas) numa transação do banco.
 */
export const commandRoutes = Router();

commandRoutes.post('/preview', validateBody(commandSchema), (req, res) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const parsed = parseCommand(req.body.text, demoCommandContext(today));
  res.status(parsed.ok ? 200 : 422).json({
    ...parsed,
    messages: parsed.issues.map((i) => ISSUE_MESSAGES[i]),
  });
});
