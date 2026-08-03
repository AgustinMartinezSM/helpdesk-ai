import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Mirrors auth-service's RegisterDto, including the 12-character minimum.
 *
 * Duplicated rather than shared on purpose: this validation exists to reject
 * an obviously malformed request at the edge, not to decide the policy.
 * auth-service validates again and its answer is the one that counts — if the
 * two ever disagree, the service wins and the BFF is merely stricter than it
 * needed to be, which is the safe direction.
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
