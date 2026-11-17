import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { AuthService, PASSWORD_RULE, PASSWORD_RULE_MESSAGE } from './auth.service';
import { AuthUser, CurrentUser, Public } from '../common/roles';

class LoginDto {
  @IsString() @IsNotEmpty() username: string;
  @IsString() @IsNotEmpty() password: string;
}

class ChangePasswordDto {
  @IsString() @IsNotEmpty() current_password: string;
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE }) new_password: string;
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

  /** POST /api/auth/change-password */
  @Post('change-password')
  @HttpCode(200)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthUser) {
    return this.auth.changePassword(user.userId, dto.current_password, dto.new_password);
  }
}
