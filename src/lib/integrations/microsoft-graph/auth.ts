import {
  ClientSecretCredential,
  ManagedIdentityCredential,
  type AccessToken,
} from "@azure/identity";

type GraphAuthMode = "managed_identity" | "client_secret";

type TokenProvider = {
  getToken(scopes: string | string[]): Promise<AccessToken | null>;
};

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 60_000;

let tokenProvider: TokenProvider | null = null;
let cachedToken: AccessToken | null = null;

function resolveGraphAuthMode(): GraphAuthMode {
  const normalized = String(process.env.MICROSOFT_GRAPH_AUTH_MODE || "managed_identity")
    .trim()
    .toLowerCase();

  if (normalized === "managed_identity") {
    return "managed_identity";
  }
  if (normalized === "client_secret") {
    return "client_secret";
  }

  throw new Error(
    `Unsupported MICROSOFT_GRAPH_AUTH_MODE '${normalized}'. Use managed_identity or client_secret.`,
  );
}

function createTokenProvider(): TokenProvider {
  const mode = resolveGraphAuthMode();

  if (mode === "client_secret") {
    const tenantId = String(process.env.MICROSOFT_GRAPH_TENANT_ID || "").trim();
    const clientId = String(process.env.MICROSOFT_GRAPH_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.MICROSOFT_GRAPH_CLIENT_SECRET || "").trim();

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        "MICROSOFT_GRAPH_TENANT_ID, MICROSOFT_GRAPH_CLIENT_ID, and MICROSOFT_GRAPH_CLIENT_SECRET are required when MICROSOFT_GRAPH_AUTH_MODE=client_secret.",
      );
    }

    return new ClientSecretCredential(tenantId, clientId, clientSecret);
  }

  const userAssignedClientId = String(process.env.AZURE_CLIENT_ID || "").trim();
  if (userAssignedClientId) {
    return new ManagedIdentityCredential(userAssignedClientId);
  }

  return new ManagedIdentityCredential();
}

function getTokenProvider() {
  if (!tokenProvider) {
    tokenProvider = createTokenProvider();
  }

  return tokenProvider;
}

function tokenIsFresh(token: AccessToken | null) {
  if (!token) {
    return false;
  }

  return token.expiresOnTimestamp - Date.now() > TOKEN_EXPIRY_SAFETY_WINDOW_MS;
}

export async function getMicrosoftGraphAccessToken() {
  if (tokenIsFresh(cachedToken)) {
    return cachedToken!.token;
  }

  const provider = getTokenProvider();
  const token = await provider.getToken(GRAPH_SCOPE);
  if (!token) {
    throw new Error("Unable to acquire Microsoft Graph access token.");
  }

  cachedToken = token;
  return token.token;
}

export function clearMicrosoftGraphTokenCache() {
  cachedToken = null;
}
