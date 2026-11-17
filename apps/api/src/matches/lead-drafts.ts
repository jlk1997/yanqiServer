/** M64：多渠道线索草稿（同批 VALUES，无 N+1） */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const shared = require(require('path').join(__dirname, '../../../../packages/shared/src/match-lib.js'));
const { buildOutreachDraft } = shared;

export function leadChannelsFromEnv(): string[] {
  const raw = process.env.MATCH_LEAD_CHANNELS || 'email_draft,wechat_draft';
  const list = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((c) => (c === 'wechat' ? 'wechat_draft' : c === 'sms' ? 'sms_draft' : c === 'email' ? 'email_draft' : c));
  const uniq = [...new Set(list)];
  return uniq.length ? uniq : ['email_draft'];
}

export type ChannelDraft = {
  channel: string;
  draftSubject: string | null;
  draftBody: string | null;
};

export function buildMultiChannelLeadDrafts(
  input: {
    demandTitle: string;
    demandOrg: string;
    supplyTitle: string;
    supplyOrg: string;
    reason: string;
    personName?: string;
    inviteUrl?: string;
    collabModeLabel?: string;
  },
  channels: string[] = leadChannelsFromEnv(),
): ChannelDraft[] {
  const email = buildOutreachDraft(input);
  return channels.map((channel) => {
    if (channel === 'wechat_draft') {
      return {
        channel,
        draftSubject: `【研企通】${String(input.demandTitle || '').slice(0, 48)}`,
        draftBody: `${input.personName || '老师'}您好：研企通匹配「${input.supplyOrg}·${input.supplyTitle}」↔贵方「${input.demandTitle}」。${String(input.reason || '').slice(0, 100)} 详情见邮件草稿。`,
      };
    }
    if (channel === 'sms_draft') {
      return {
        channel,
        draftSubject: null,
        draftBody: `【研企通】${input.demandOrg}需求「${String(input.demandTitle || '').slice(0, 24)}」与「${input.supplyOrg}」可对接，请查收邮件草稿。`,
      };
    }
    if (channel === 'in_app_draft') {
      return {
        channel,
        draftSubject: email.subject,
        draftBody: `站内草稿：${String(input.reason || '').slice(0, 160)} · 邀请 ${input.inviteUrl || '—'}`,
      };
    }
    return {
      channel: channel || 'email_draft',
      draftSubject: email.subject,
      draftBody: email.body,
    };
  });
}
