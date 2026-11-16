import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public } from '../common/roles';

class LoginDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() password: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/login  -> { accessToken, user } */
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  /** GET /api/auth/me -> the logged-in user */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
