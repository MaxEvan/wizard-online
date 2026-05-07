export function getStoredPlayerId(roomCode: string): string | null {
  return localStorage.getItem(playerStorageKey(roomCode));
}

export function storePlayerId(roomCode: string, playerId: string): void {
  localStorage.setItem(playerStorageKey(roomCode), playerId);
}

export function getStoredName(): string {
  return localStorage.getItem("wizard-name") ?? "";
}

export function storeName(name: string): void {
  localStorage.setItem("wizard-name", name);
}

function playerStorageKey(roomCode: string): string {
  return `wizard-player:${roomCode.toUpperCase()}`;
}

