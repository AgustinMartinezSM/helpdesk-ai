import { IsUUID } from 'class-validator';

/**
 * Where to go. Who is asking comes from the bearer token this request
 * forwards, never from the body — a user field here would let anybody holding
 * an account ask for a token minted for somebody else.
 */
export class ChooseOrganizationDto {
  @IsUUID()
  organizationId!: string;
}
