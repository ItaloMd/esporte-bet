import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (slice) => {
    let sum = 0;
    for (let i = 0; i < slice.length; i += 1) {
      sum += Number(cpf[i]) * (slice.length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(cpf.slice(0, 9)) === Number(cpf[9]) && calc(cpf.slice(0, 10)) === Number(cpf[10]);
}

function maskCpf(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return '***.***.***-**';
  return `***.${digits.slice(3, 6)}.***-${digits.slice(9)}`;
}

function maskEmail(email) {
  const [name, domain] = String(email || '').split('@');
  if (!domain) return 'cadastro atribuído';
  return `${name.slice(0, 2)}***@${domain}`;
}

function ageFrom(value) {
  if (!value) return null;
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return null;
  const diff = Date.now() - birth.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

function codeFromName(name) {
  const base = String(name || 'PLAYER')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 6) || 'PLAYER';
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}${suffix}`;
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Faça login para concluir o cadastro.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const fullName = String(body.full_name || '').trim().slice(0, 120);
    const cpf = onlyDigits(body.cpf);
    const birthDate = String(body.birth_date || '').trim();
    const displayName = String(body.display_name || '').trim().slice(0, 60) || fullName.split(' ')[0];
    const state = String(body.state || '').trim().slice(0, 40);
    const city = String(body.city || '').trim().slice(0, 60);
    const refCode = normalizeCode(body.ref_code);

    if (fullName.length < 5 || !fullName.includes(' ')) {
      return Response.json({ error: 'Informe seu nome completo.', field: 'full_name' }, { status: 400 });
    }
    if (!isValidCpf(cpf)) {
      return Response.json({ error: 'CPF inválido: confira os números informados.', field: 'cpf' }, { status: 400 });
    }
    const age = ageFrom(birthDate);
    if (age === null) {
      return Response.json({ error: 'Informe sua data de nascimento.', field: 'birth_date' }, { status: 400 });
    }
    if (age < 18) {
      return Response.json({ error: 'É necessário ter 18 anos ou mais para usar a plataforma.', field: 'birth_date' }, { status: 400 });
    }

    const service = base44.asServiceRole.entities;
    const existingByCpf = await service.UserProfile.filter({ cpf }, { limit: 1 });
    const cpfOwner = existingByCpf.items?.[0];
    if (cpfOwner && cpfOwner.user_id !== user.id) {
      return Response.json(
        { error: 'Este CPF já está vinculado a outra conta. Uma conta por CPF.', field: 'cpf', code: 'cpf_in_use' },
        { status: 409 },
      );
    }

    const ownProfiles = await service.UserProfile.filter({ user_id: user.id }, { limit: 1 });
    const current = ownProfiles.items?.[0];
    if (current && onlyDigits(current.cpf) && onlyDigits(current.cpf) !== cpf) {
      return Response.json(
        { error: 'O CPF não pode ser alterado após o cadastro. Use a solicitação de correção cadastral.', field: 'cpf', code: 'cpf_locked' },
        { status: 409 },
      );
    }

    const payload = {
      user_id: user.id,
      full_name: fullName,
      display_name: displayName,
      cpf,
      cpf_masked: maskCpf(cpf),
      birth_date: birthDate,
      state: state || undefined,
      city: city || undefined,
      cpf_checked: true,
      identity_status: current?.identity_status === 'verified' ? 'verified' : 'pending',
      onboarding_complete: true,
      terms_accepted_at: new Date().toISOString(),
      privacy_accepted_at: new Date().toISOString(),
    };

    const profile = current
      ? await service.UserProfile.update(current.id, payload)
      : await service.UserProfile.create(payload);

    if (!current) {
      await service.IdentityVerification.create({
        user_id: user.id,
        cpf_masked: maskCpf(cpf),
        method: 'manual',
        status: 'pending',
        reference: `profile:${profile.id}`,
        notes: 'Validação matemática do CPF concluída. Verificação de identidade por provedor externo pendente de integração.',
      });
    }

    const prefs = await service.NotificationPreference.filter({ user_id: user.id }, { limit: 1 });
    if (!prefs.items?.length) {
      await service.NotificationPreference.create({ user_id: user.id });
    }

    const settingsPage = await service.AppSettings.list({ limit: 1 });
    const settings = settingsPage.items?.[0] || {};

    let affiliate = (await service.AffiliateProfile.filter({ user_id: user.id }, { limit: 1 })).items?.[0];
    if (!affiliate) {
      let code = codeFromName(displayName);
      const clash = await service.AffiliateProfile.filter({ code }, { limit: 1 });
      if (clash.items?.length) code = `${code}${Math.floor(Math.random() * 90 + 10)}`;
      affiliate = await service.AffiliateProfile.create({
        user_id: user.id,
        code,
        status: settings.affiliate_approval_required === false ? 'active' : 'pending',
        eligible: settings.affiliate_enabled !== false,
        commission_rule: settings.affiliate_commission_rule || 'Recompensas demonstrativas — política de comissões sujeita a validação jurídica.',
        clicks: 0,
        referrals: 0,
        conversions: 0,
      });
    }

    let referral = { attributed: false, reason: 'sem_codigo' };
    if (refCode) {
      const affiliatePage = await service.AffiliateProfile.filter({ code: refCode }, { limit: 1 });
      const referrer = affiliatePage.items?.[0];
      if (!referrer) {
        referral = { attributed: false, reason: 'codigo_invalido' };
      } else if (referrer.user_id === user.id) {
        referral = { attributed: false, reason: 'autorreferencia' };
      } else if (referrer.status === 'blocked' || referrer.eligible === false) {
        referral = { attributed: false, reason: 'indicador_inelegivel' };
      } else {
        const already = await service.AffiliateReferral.filter({ referred_user_id: user.id }, { limit: 1 });
        if (already.items?.length) {
          referral = { attributed: false, reason: 'ja_atribuido' };
        } else {
          const attributedAt = new Date().toISOString();
          await service.AffiliateReferral.create({
            code: refCode,
            referrer_user_id: referrer.user_id,
            referred_user_id: user.id,
            referred_label: maskEmail(user.email),
            status: settings.affiliate_approval_required === false ? 'approved' : 'pending',
            source: 'link',
            attributed_at: attributedAt,
            note: 'Indicação atribuída no cadastro. Sem remuneração nesta fase (protótipo).',
          });
          await service.AffiliateProfile.update(referrer.id, {
            referrals: Number(referrer.referrals || 0) + 1,
            conversions: Number(referrer.conversions || 0) + 1,
            last_activity_at: attributedAt,
          });
          referral = { attributed: true, reason: 'ok' };
        }
      }
    }

    await service.AdminAuditLog.create({
      actor_id: user.id,
      actor_email: maskEmail(user.email),
      action: current ? 'user_profile.updated' : 'user_profile.created',
      target_type: 'UserProfile',
      target_id: profile.id,
      details: `CPF ${maskCpf(cpf)} · indicação: ${referral.attributed ? 'atribuída' : referral.reason}`,
      severity: 'info',
    });

    return Response.json({
      status: 'ok',
      profile: {
        id: profile.id,
        display_name: profile.display_name,
        full_name: profile.full_name,
        cpf_masked: profile.cpf_masked,
        identity_status: profile.identity_status,
        referral_code: affiliate?.code,
      },
      referral,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Não foi possível concluir o cadastro.' }, { status: 500 });
  }
}