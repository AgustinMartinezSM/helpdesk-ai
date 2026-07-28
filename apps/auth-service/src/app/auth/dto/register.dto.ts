import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    description: 'Minimum 12 characters; no composition rules.',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
