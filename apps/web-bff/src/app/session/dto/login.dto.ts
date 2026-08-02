import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  /** Shared machine (a store till): shortens the session upstream and makes
   * the refresh cookie die with the browser. Only ever shrinks. */
  @IsOptional()
  @IsBoolean()
  sharedWorkstation?: boolean;
}
