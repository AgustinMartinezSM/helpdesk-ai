import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body shape shared by refresh and logout. */
export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh credential issued at login.' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refreshToken!: string;
}
