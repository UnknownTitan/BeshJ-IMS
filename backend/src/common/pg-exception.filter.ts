import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { DatabaseError } from 'pg';

/**
 * Turns PostgreSQL errors into clear HTTP answers, so the database's own
 * constraints (CHECK, UNIQUE, FOREIGN KEY) act as the final line of validation.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof HttpException) {
      return res.status(err.getStatus()).json(err.getResponse());
    }

    if (err instanceof DatabaseError) {
      const map: Record<string, [number, string]> = {
        '23505': [HttpStatus.CONFLICT, 'A record with this value already exists'],
        '23503': [HttpStatus.BAD_REQUEST, 'A referenced record does not exist or is still in use'],
        '23514': [HttpStatus.BAD_REQUEST, 'The data breaks a business rule'],
        '23502': [HttpStatus.BAD_REQUEST, 'A required value is missing'],
        '22P02': [HttpStatus.BAD_REQUEST, 'A value has the wrong format'],
        P0001: [HttpStatus.BAD_REQUEST, err.message], // RAISE EXCEPTION in our functions
      };
      const [status, message] = map[err.code ?? ''] ?? [HttpStatus.INTERNAL_SERVER_ERROR, 'Database error'];
      if (status === HttpStatus.INTERNAL_SERVER_ERROR) this.logger.error(err.message);
      return res.status(status).json({ statusCode: status, message, constraint: err.constraint });
    }

    this.logger.error(err instanceof Error ? err.stack : String(err));
    return res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ statusCode: 500, message: 'Something went wrong' });
  }
}
