import type {
  BusinessEntityActionItemRequest,
  BusinessEntityActionItemResponse,
} from "@tradeos/contracts";
import { readApiErrorMessage } from "../../../lib/auth-fetch";

type AuthenticatedFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function createEntityActionItem(
  fetcher: AuthenticatedFetcher,
  input: BusinessEntityActionItemRequest,
): Promise<BusinessEntityActionItemResponse> {
  const response = await fetcher("/v1/intelligence/entity/action-items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Review task could not be created"));
  }
  const payload = await response.json() as Partial<BusinessEntityActionItemResponse>;
  if (!payload.item || typeof payload.created !== "boolean") {
    throw new Error("Server returned an incomplete entity action item response.");
  }
  return { item: payload.item, created: payload.created };
}
