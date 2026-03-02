import { StringEnum } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";

export const ACCOUNT_STORE_VERSION = 1 as const;

export const MODEL_FAMILY_VALUES = ["claude", "gemini"] as const;

export const ModelFamilySchema = StringEnum(MODEL_FAMILY_VALUES);
export type ModelFamily = Static<typeof ModelFamilySchema>;

export const RateLimitResetTimesSchema = Type.Object(
  {
    claude: Type.Optional(Type.Number({ minimum: 0 })),
    gemini: Type.Optional(Type.Number({ minimum: 0 }))
  },
  { additionalProperties: false }
);
export type RateLimitResetTimes = Static<typeof RateLimitResetTimesSchema>;

export const AccountSchema = Type.Object(
  {
    email: Type.String({ minLength: 1 }),
    refreshToken: Type.String({ minLength: 1 }),
    projectId: Type.String({ minLength: 1 }),
    enabled: Type.Boolean(),
    addedAt: Type.Number({ minimum: 0 }),
    lastUsed: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    rateLimitResetTimes: RateLimitResetTimesSchema,
    verificationRequired: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
);
export type Account = Static<typeof AccountSchema>;

export const ActiveIndexByFamilySchema = Type.Object(
  {
    claude: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    gemini: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
  },
  { additionalProperties: false }
);
export type ActiveIndexByFamily = Static<typeof ActiveIndexByFamilySchema>;

export const AccountStoreSchema = Type.Object(
  {
    version: Type.Literal(ACCOUNT_STORE_VERSION),
    accounts: Type.Array(AccountSchema),
    activeIndexByFamily: ActiveIndexByFamilySchema
  },
  { additionalProperties: false }
);

export type AccountStore = Static<typeof AccountStoreSchema>;
