const defaultCountryCallingCode = '229';

function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

export function normalizeEmail(value?: string | null) {
  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') ? email : undefined;
}

export function normalizePhoneNumber(value?: string | null, countryCallingCode = defaultCountryCallingCode) {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  if (raw.startsWith('+')) {
    const digits = digitsOnly(raw);
    return digits ? `+${digits}` : undefined;
  }

  if (raw.startsWith('00')) {
    const digits = digitsOnly(raw.slice(2));
    return digits ? `+${digits}` : undefined;
  }

  const digits = digitsOnly(raw);
  if (!digits) return undefined;

  if (digits.startsWith(countryCallingCode) && digits.length > countryCallingCode.length) {
    return `+${digits}`;
  }

  return `+${countryCallingCode}${digits}`;
}

export function normalizeContactIdentity(input: {
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
}) {
  return {
    emailNormalized: normalizeEmail(input.email),
    phoneNormalized: normalizePhoneNumber(input.phone),
    whatsappNormalized: normalizePhoneNumber(input.whatsapp)
  };
}
