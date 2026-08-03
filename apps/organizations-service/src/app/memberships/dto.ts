import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsUUID } from 'class-validator';
import {
  MEMBERSHIP_STATUSES,
  type MembershipStatus,
} from '../../domain/membership';
import { GRANTABLE_ROLE_TEMPLATES } from '../../domain/role-grants';

export class ChangeMembershipStatusDto {
  /**
   * Target status only. Whether the move is legal is the transition table's
   * decision (409), not validation's (400): validation rejects words that
   * are not statuses, the domain rejects statuses that are not reachable.
   */
  @ApiProperty({ enum: MEMBERSHIP_STATUSES })
  @IsIn(MEMBERSHIP_STATUSES)
  status!: MembershipStatus;
}

export class ChangeMembershipRoleDto {
  /**
   * `owner` is absent on purpose (see GRANTABLE_ROLE_TEMPLATES) — it is
   * refused as a grant here and as a target in the use case. Beyond the
   * vocabulary, whether THIS caller may hand out THIS template is the
   * ceiling's decision (403), not validation's.
   */
  @ApiProperty({ enum: GRANTABLE_ROLE_TEMPLATES })
  @IsIn(GRANTABLE_ROLE_TEMPLATES)
  roleTemplate!: string;
}

export class SetMembershipBranchesDto {
  /**
   * The full desired set, not a delta: anything absent is removed. An empty
   * array is a legitimate request — it means "covers no branch", which for a
   * holder of `tickets.read_branch` denies rather than widens (Sprint 9.5).
   */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  branchIds!: string[];
}
