// Werewolf game phases

export enum WerewolfPhase {
  Night = 'night',
  DayAnnounce = 'day_announce',
  DayDiscuss = 'day_discuss',
  DayVote = 'day_vote',
  HunterShoot = 'hunter_shoot',
  GameOver = 'game_over',
}

/** Sub-phases within night for ordering role actions */
export enum NightSubPhase {
  GuardProtect = 'guard_protect',
  WerewolfKill = 'werewolf_kill',
  WitchAct = 'witch_act',
  SeerInspect = 'seer_inspect',
}

export const NIGHT_ACTION_ORDER: NightSubPhase[] = [
  NightSubPhase.GuardProtect,
  NightSubPhase.WerewolfKill,
  NightSubPhase.WitchAct,
  NightSubPhase.SeerInspect,
];
