export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
};

type LocalAccount = {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
};

const ACCOUNTS_KEY = "fm_counselor_accounts";
const SESSION_KEY = "fm_counselor_session";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function readAccounts(): LocalAccount[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]") as LocalAccount[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: LocalAccount[]) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function toSessionUser(account: LocalAccount): SessionUser {
  return {
    id: account.id,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    phone: account.phone,
  };
}

export function loadSession(): SessionUser | null {
  try {
    const user = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") as SessionUser | null;
    if (!user?.id || !user.email) return null;
    return user;
  } catch {
    return null;
  }
}

export function saveSession(user: SessionUser) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function upsertAccount(input: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  id?: string;
}) {
  const email = normalizeEmail(input.email);
  const accounts = readAccounts();
  const existing = accounts.find((account) => account.email === email);
  const account: LocalAccount = {
    id: input.id || existing?.id || crypto.randomUUID(),
    email,
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone || existing?.phone,
  };
  writeAccounts([...accounts.filter((item) => item.email !== email), account]);
  return account;
}

export function updateAccountProfile(email: string, input: { firstName: string; lastName: string; phone?: string }) {
  const key = normalizeEmail(email);
  const accounts = readAccounts();
  writeAccounts(
    accounts.map((account) =>
      account.email === key ? { ...account, firstName: input.firstName, lastName: input.lastName, phone: input.phone } : account,
    ),
  );
}

export function verifyAccount(email: string, password: string) {
  const account = readAccounts().find((item) => item.email === normalizeEmail(email));
  if (!account) return null;
  if (account.password !== password) return null;
  return account;
}
