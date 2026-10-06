import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /api/roles/:id — 改名。 */
export class RenameRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  roleName!: string;
}
