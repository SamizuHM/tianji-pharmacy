export const HUBEI_CITY_NAMES = [
  "武汉",
  "黄石",
  "十堰",
  "宜昌",
  "襄阳",
  "鄂州",
  "荆门",
  "孝感",
  "荆州",
  "黄冈",
  "咸宁",
  "随州",
  "恩施",
  "仙桃",
  "潜江",
  "天门",
  "神农架",
] as const;

export type HubeiCityName = (typeof HUBEI_CITY_NAMES)[number];
export type KnowledgeScopeLevelValue = "common" | "city";

export function isHubeiCityName(value: string): value is HubeiCityName {
  return HUBEI_CITY_NAMES.includes(value as HubeiCityName);
}

export function normalizeScopeInput(input: {
  scopeTarget?: string | null;
  scopeLevel?: string | null;
  cityName?: string | null;
}) {
  const scopeTarget = input.scopeTarget?.trim() || "";
  const cityName = (input.cityName?.trim() || (scopeTarget !== "common" ? scopeTarget : "")).trim();
  const isCityScope = Boolean(cityName) || input.scopeLevel === "city";

  if (!isCityScope) {
    return { ok: true as const, scopeLevel: "common" as const, cityName: null };
  }

  if (!cityName || !isHubeiCityName(cityName)) {
    return {
      ok: false as const,
      error: "城市专属知识必须选择湖北省内城市",
    };
  }

  return { ok: true as const, scopeLevel: "city" as const, cityName };
}
