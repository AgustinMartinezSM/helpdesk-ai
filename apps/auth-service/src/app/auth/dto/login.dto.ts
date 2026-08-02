import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description:
      'Declares the machine shared (a store till): the refresh credential ' +
      'then lives hours instead of weeks. Only ever shortens the session.',
  })
  @IsOptional()
  @IsBoolean()
  sharedWorkstation?: boolean;
}
