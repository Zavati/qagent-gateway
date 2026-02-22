import { markEmailEventStatus, saveEmailDispatchAck } from './emailEventService.js';

function nowIso() { return new Date().toISOString(); }

function buildMessageFromEvent(evt) {
  const template = evt.template || 'generic';
  if (template === 'paid_access_token') {
    const token = evt.metadata?.token || '[token]';
    const subject = 'Seu token de acesso — QAgent';
    const text = `Obrigado pela compra. Use o token abaixo para acessar por 30 dias:\n\n${token}\n\nEste token expira em 30 dias.`;
    return { subject, text };
  }

  if (template === 'trial_welcome') {
    const subject = 'Bem-vindo ao QAgent';
    const text = 'Seu trial foi ativado. Aproveite o QAgent!';
    return { subject, text };
  }

  return { subject: 'Mensagem QAgent', text: 'Você possui uma nova notificação.' };
}

export async function sendEmailEvent(env, evt) {
  // persist is expected to be done by caller (evt saved in KV)
  const webhookUrl = String(env?.EMAIL_DISPATCH_WEBHOOK_URL || '').trim();

  // Helper to mark status
  async function mark(status, extra = {}) {
    try {
      await markEmailEventStatus(env, evt.eventId, status, { ...extra, updatedAt: nowIso() });
    } catch (e) {
      console.log('markEmailEventStatus_error', e?.message || e);
    }
  }

  // First try webhook dispatch if configured
  if (webhookUrl) {
    try {
      const payload = {
        eventId: evt.eventId,
        occurredAt: evt.occurredAt,
        type: 'email.dispatch.requested',
        customerId: evt.customerId,
        email: evt.email,
        template: evt.template,
        metadata: evt.metadata,
      };
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        await mark('dispatched', { dispatchedAt: nowIso() });
        return { ok: true };
      }
      await mark('dispatch_failed', { httpStatus: resp.status });
      return { ok: false, status: resp.status };
    } catch (e) {
      await mark('dispatch_failed', { error: e?.message || String(e) });
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // Fallback: if MailerSend configured, send directly
  const mailerKey = String(env?.MAILERSEND_API_KEY || '').trim();
  if (mailerKey) {
    try {
      const fromEmail = String(env?.MAILERSEND_FROM || 'no-reply@apiqagent.com').trim();
      const fromName = String(env?.MAILERSEND_FROM_NAME || 'QAgent').trim();
      const message = buildMessageFromEvent(evt);

      const body = {
        from: { email: fromEmail, name: fromName },
        to: [{ email: evt.email }],
        subject: message.subject,
        text: message.text,
      };

      const r = await fetch('https://api.mailersend.com/v1/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mailerKey}`,
        },
        body: JSON.stringify(body),
      });

      if (r.ok) {
        await mark('dispatched', { dispatchedAt: nowIso() });
        return { ok: true };
      }
      const txt = await r.text();
      await mark('dispatch_failed', { httpStatus: r.status, detail: txt.slice(0, 400) });
      return { ok: false, status: r.status, detail: txt };
    } catch (e) {
      await mark('dispatch_failed', { error: e?.message || String(e) });
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // No dispatch mechanism configured
  await mark('pending_no_webhook');
  return { ok: false, reason: 'no_dispatch_configured' };
}

export default { sendEmailEvent };
