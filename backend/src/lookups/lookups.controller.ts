import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/** Small reference lists used to fill drop-downs in forms. */
@Controller()
export class LookupsController {
  constructor(private readonly db: DatabaseService) {}

  @Get('categories')
  categories() {
    return this.db.query(`SELECT category_id, category_name, description FROM category ORDER BY category_name`);
  }

  @Get('container-types')
  containerTypes() {
    return this.db.query(`SELECT * FROM container_type ORDER BY container_name`);
  }

  @Get('locations')
  locations() {
    return this.db.query(
      `SELECT l.location_id, l.location_name, l.location_type, l.vehicle_reg, l.home_location_id, l.driver_id, u.full_name AS driver_name
         FROM stock_location l LEFT JOIN app_user u ON u.user_id = l.driver_id
        WHERE l.is_active
        ORDER BY l.location_type DESC, l.location_name`,
    );
  }

  /** Active staff names and roles, e.g. to name who was responsible for a breakage. */
  @Get('staff')
  staff() {
    return this.db.query(`SELECT user_id, full_name, role FROM app_user WHERE is_active ORDER BY full_name`);
  }
}
