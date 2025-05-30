import { db } from "@/lib/db";
import { compare } from "bcrypt";
import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";

// Define our own session type to include the ID property
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export const authOptions: NextAuthOptions = {
  // No adapter - using JWT strategy
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent select_account",
        },
      },
    }),
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const existingUser = await db.user.findUnique({
          where: { email: credentials.email },
        });

        if (!existingUser || !existingUser.password) {
          return null;
        }

        const passwordMatch = await compare(
          credentials.password,
          existingUser.password
        );

        if (!passwordMatch) {
          return null;
        }

        return {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          image: existingUser.image,
        };
      },
    }),
  ],
  callbacks: {
    async session({ token, session }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.name = token.name;
        session.user.email = token.email;
        session.user.image = token.picture;
      }
      return session;
    },
    async jwt({ token, user, account, profile }) {
      // Initial sign in
      if (account && user) {
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.image,
          provider: account.provider,
        };
      }

      // Return previous token if the user hasn't changed
      const dbUser = await db.user.findFirst({
        where: {
          email: token.email,
        },
      });

      if (!dbUser) {
        if (user) {
          token.id = user.id;
        }
        return token;
      }

      return {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        picture: dbUser.image,
      };
    },
    async signIn({ user, account, profile }) {
      if (!user.email) return false;

      if (account?.provider === "google" || account?.provider === "github") {
        // Check if user exists
        const existingUser = await db.user.findUnique({
          where: { email: user.email },
        });

        if (existingUser) {
          // Update existing user with OAuth data
          await db.user.update({
            where: { id: existingUser.id },
            data: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              idToken: account.id_token,
              scope: account.scope,
              tokenType: account.token_type,
              expiresAt: account.expires_at ? parseInt(account.expires_at.toString()) : null,
            } as any,
          });
        } else {
          // Create new user with OAuth data
          await db.user.create({
            data: {
              email: user.email,
              name: user.name,
              image: user.image,
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              idToken: account.id_token,
              scope: account.scope,
              tokenType: account.token_type,
              expiresAt: account.expires_at ? parseInt(account.expires_at.toString()) : null,
            } as any,
          });
        }
      }

      return true;
    },
  },
};
