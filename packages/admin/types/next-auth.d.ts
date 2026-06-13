import "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    personId?: string;
  }
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      role: string;
      personId?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: string;
    personId?: string;
  }
}
