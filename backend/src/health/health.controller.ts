import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Public } from '../common/roles';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /** GET /api/health - is the API up and can it reach PostgreSQL? */
  @Public()
  @Get()
  async check() {
    const row = await this.db.one<{ now: string; tables: string }>(
      `SELECT now()::text AS now,
              (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'ims' AND table_type = 'BASE TABLE')::text AS tables`,
    );
    return { status: 'ok', database: 'connected', serverTime: row?.now, tables: Number(row?.tables) };
  }
}
