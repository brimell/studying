import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getGoogleAuthEnv } from "@/lib/env";
import type { Session } from "next-auth";

type TokenWithGoogle = {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number;
  error?: string;
};

type SessionWithGoogle = Session & {
  accessToken?: string;
  authError?: string;
};

async function refreshGoogleAccessToken(token: TokenWithGoogle): Promise<TokenWithGoogle> {
  if (!token.refreshToken) {
    return { ...token, error: "MissingRefreshToken" };
  }

  try {
    const params = new URLSearchParams({
      client_id: googleEnv.clientId,
      client_secret: googleEnv.clientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });

    const refreshed = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
    };

    if (!response.ok || !refreshed.access_token) {
      return { ...token, error: refreshed.error || "RefreshAccessTokenError" };
    }

    return {
      ...token,
      accessToken: refreshed.access_token,
      accessTokenExpiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
      refreshToken: refreshed.refresh_token || token.refreshToken,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

const googleEnv = getGoogleAuthEnv();

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: googleEnv.nextAuthSecret,
  providers: [
    Google({
      clientId: googleEnv.clientId,
      clientSecret: googleEnv.clientSecret,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Persist the access_token and refresh_token from the provider
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token || token.refreshToken;
        token.accessTokenExpiresAt = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 3600 * 1000;
        token.error = undefined;
        return token;
      }

      const typedToken = token as TokenWithGoogle;
      if (
        typedToken.accessToken &&
        typedToken.accessTokenExpiresAt &&
        Date.now() < typedToken.accessTokenExpiresAt - 60_000
      ) {
        return token;
      }

      const refreshed = await refreshGoogleAccessToken(typedToken);
      return { ...token, ...refreshed };
    },
    async session({ session, token }) {
      // Make the access token available on the session
      const nextSession = session as SessionWithGoogle;
      nextSession.accessToken = token.accessToken as string | undefined;
      nextSession.authError = (token as TokenWithGoogle).error;
      return session;
    },
  },
});
