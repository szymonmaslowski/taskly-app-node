const minimumSecretLength = 12;

function base64Cores(value: string, alphabet: 'base64' | 'base64url') {
  // Base64 output depends on where the value starts within a 3-byte group, so each offset gets its own stable middle part.
  return [0, 1, 2].map((offset) => {
    const encoded = Buffer.from(`${'\0'.repeat(offset)}${value}`).toString(alphabet).replace(/=+$/, '');
    return encoded.slice(4, -4);
  });
}

export function encodedForms(secret: string) {
  const reversed = [...secret].reverse().join('');
  const hex = Buffer.from(secret).toString('hex');
  return [
    secret,
    reversed,
    encodeURIComponent(secret),
    hex,
    hex.toUpperCase(),
    ...base64Cores(secret, 'base64'),
    ...base64Cores(secret, 'base64url'),
    ...base64Cores(reversed, 'base64'),
  ].filter((form) => form.length >= minimumSecretLength);
}

export type SecretLeak = {
  source: string;
  secretName: string;
};

// A deliberate custom encoding still gets through; the real controls are the writable allowlist, no symbolic links and no Bash.
export function findSecretLeaks(texts: { source: string; content: string }[], secrets: { name: string; value: string }[]) {
  const leaks: SecretLeak[] = [];
  for (const { name, value } of secrets) {
    if (value.length < minimumSecretLength) continue;
    const forms = encodedForms(value);
    for (const { source, content } of texts) {
      if (forms.some((form) => content.includes(form))) leaks.push({ source, secretName: name });
    }
  }
  return leaks;
}
