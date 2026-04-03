// Werewolf game type definitions

import { Role, Faction } from './roles';
import { WerewolfPhase } from './phases';

export interface WerewolfPlayer {
  agent_id: string;
  seat: number;
  role: Role;
  faction: Faction;
  alive: boolean;
}

export interface WerewolfState {
  match_id: string;
  phase: WerewolfPhase;
  turn: number;
  players: WerewolfPlayer[];
  // Night action accumulation
  night_actions: {
    guard_target: number | null;
    wolf_target: number | null;         // resolved target (majority or random)
    wolf_votes: Record<number, number>; // wolf_seat -> target_seat (individual wolf votes)
    witch_save: boolean;
    witch_poison_target: number | null;
    seer_target: number | null;
  };
  // Witch potion tracking
  witch_potions: { antidote: boolean; poison: boolean };
  // Guard cannot protect same target twice in a row
  last_guard_target: number | null;
  // Discussion messages for current day
  discussion: Array<{ seat: number; message: string }>;
  // Discussion turn tracking: seat-ordered speaking
  discussion_order: number[];           // ordered seats for speaking this day
  discussion_current_index: number;     // index into discussion_order of current speaker
  // Votes for current day
  votes: Record<number, number>;    // voter_seat -> target_seat
  // Seer accumulated results
  seer_results: Array<{ seat: number; is_wolf: boolean }>;
  // Seed for deterministic randomness
  seed: number;
  // Night deaths to announce in DayAnnounce
  pending_death_announcements: number[];
  _witch_acted?: boolean;
  _pending_deaths?: number[];
  _hunter_trigger_seat?: number | null;
  _hunter_trigger_source?: "night" | "vote" | null;
  _last_vote_result?: { votes: Record<number, number>; eliminated?: number };
  _night_sub_phase?: string | null;
  _acknowledged_seats?: number[];
}

export interface WerewolfAgentView {
  match_id: string;
  phase: string;
  turn: number;
  your_seat: number;
  your_role: Role;
  alive_players: number[];
  dead_players: Array<{ seat: number; role?: Role }>;
  wolf_teammates?: number[];
  seer_results?: Array<{ seat: number; is_wolf: boolean }>;
  witch_potions?: { antidote: boolean; poison: boolean };
  wolf_target?: number;
  discussion: Array<{ seat: number; message: string }>;
  last_vote_result?: { votes: Record<number, number>; eliminated?: number };
  nightSubPhase?: string | null;
}
