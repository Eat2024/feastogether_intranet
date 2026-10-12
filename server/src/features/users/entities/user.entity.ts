import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditableEntity } from '#app/infrastructure/database/auditable.entity';
import { Department } from './department.entity';

@Entity({ name: 'users', comment: '員工與登入主體' })
@Index('uq_users_empid', ['empid'], { unique: true })
@Index('idx_users_person_status', ['personStatus'])
@Index('idx_users_is_active', ['isActive'])
@Index('idx_users_department_id', ['departmentId'])
@Index('idx_users_last_login_at', ['lastLoginAt'])
@Index('idx_users_created_at', ['createdAt'])
@Index('idx_users_updated_at', ['updatedAt'])
@Index('idx_users_deleted_at', ['deletedAt'])
export class User extends AuditableEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint', comment: '員工流水號' })
  id!: number;

  @Column({
    name: 'empid',
    type: 'varchar',
    length: 32,
    comment: '公司員工編號',
  })
  empid!: string;

  @Column({
    name: 'name',
    type: 'varchar',
    length: 100,
    comment: '員工姓名',
  })
  name!: string;

  @Column({
    name: 'person_status',
    type: 'varchar',
    length: 50,
    nullable: true,
    comment: '上游人員狀態',
  })
  personStatus?: string;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
    comment: '是否可登入',
  })
  isActive!: boolean;

  @Column({
    name: 'department_id',
    type: 'bigint',
    nullable: true,
    comment: '所屬部門 ID',
  })
  departmentId?: number;

  @ManyToOne(() => Department, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'department_id',
    foreignKeyConstraintName: 'fk_users_department',
  })
  department?: Department;

  @Column({
    name: 'department_name',
    type: 'varchar',
    length: 150,
    nullable: true,
    comment: '部門名稱顯示值',
  })
  departmentName?: string;

  @Column({
    name: 'title_name',
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '目前職稱',
  })
  titleName?: string;

  @Column({
    name: 'last_login_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
    comment: '最近登入時間',
  })
  lastLoginAt?: Date;
}
