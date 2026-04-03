// Werewolf role definitions
// Roles: 狼人, 村民, 预言家, 女巫, 猎人, 守卫

export enum Role {
  Werewolf = 'werewolf',   // 狼人
  Villager = 'villager',   // 村民
  Seer = 'seer',           // 预言家
  Witch = 'witch',         // 女巫
  Hunter = 'hunter',       // 猎人
  Guard = 'guard',         // 守卫
}

export enum Faction {
  Werewolf = 'werewolf',
  Village = 'village',
}

export const ROLE_FACTION: Record<Role, Faction> = {
  [Role.Werewolf]: Faction.Werewolf,
  [Role.Villager]: Faction.Village,
  [Role.Seer]: Faction.Village,
  [Role.Witch]: Faction.Village,
  [Role.Hunter]: Faction.Village,
  [Role.Guard]: Faction.Village,
};

export interface RoleConfig {
  role: Role;
  count: number;
}

/** Recommended configurations by player count */
export const PLAYER_CONFIGS: Record<number, RoleConfig[]> = {
  8: [
    { role: Role.Werewolf, count: 2 },
    { role: Role.Villager, count: 2 },
    { role: Role.Seer, count: 1 },
    { role: Role.Witch, count: 1 },
    { role: Role.Hunter, count: 1 },
    { role: Role.Guard, count: 1 },
  ],
  10: [
    { role: Role.Werewolf, count: 3 },
    { role: Role.Villager, count: 3 },
    { role: Role.Seer, count: 1 },
    { role: Role.Witch, count: 1 },
    { role: Role.Hunter, count: 1 },
    { role: Role.Guard, count: 1 },
  ],
  12: [
    { role: Role.Werewolf, count: 3 },
    { role: Role.Villager, count: 5 },
    { role: Role.Seer, count: 1 },
    { role: Role.Witch, count: 1 },
    { role: Role.Hunter, count: 1 },
    { role: Role.Guard, count: 1 },
  ],
};
