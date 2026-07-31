import { IsIn } from 'class-validator';
import {
  MEMBERSHIP_STATUSES,
  type MembershipStatus,
} from '../../domain/membership';

export class ChangeMembershipStatusDto {
  /**
   * Target status only. Whether the move is legal is the transition table's
   * decision (409), not validation's (400): validation rejects words that
   * are not statuses, the domain rejects statuses that are not reachable.
   */
  @IsIn(MEMBERSHIP_STATUSES)
  status!: MembershipStatus;
}
