import type { PublicRoomState, RoomOptions } from "@wizard/shared";

type RoomAuthResponse = {
  playerId: string;
  room: PublicRoomState;
};

export async function createRoom(
  name: string,
  options: Partial<RoomOptions>,
  simulateBots = false,
): Promise<RoomAuthResponse> {
  return request("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ name, options, simulateBots }),
  });
}

export async function joinRoom(code: string, name: string, playerId?: string): Promise<RoomAuthResponse> {
  return request(`/api/rooms/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ name, playerId }),
  });
}

export async function loadRoom(code: string, playerId: string): Promise<PublicRoomState> {
  const query = new URLSearchParams({ playerId });
  return request(`/api/rooms/${code}?${query.toString()}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Request failed.");
  }

  return (await response.json()) as T;
}
