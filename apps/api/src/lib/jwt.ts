import { SignJWT, jwtVerify } from "jose";

import { config } from "../config";

export type AuthPayload = {
  sub: string;
  telegram_id: number;
};

const encoder = new TextEncoder();

export const signAccessToken = async (payload: AuthPayload) => {
  const secret = encoder.encode(config.JWT_SECRET);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${config.JWT_TTL_SEC}s`)
    .sign(secret);
};

export const verifyAccessToken = async (token: string) => {
  const secret = encoder.encode(config.JWT_SECRET);
  const { payload } = await jwtVerify<AuthPayload>(token, secret);
  return payload;
};
