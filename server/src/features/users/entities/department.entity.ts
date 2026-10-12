import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserAuditableEntity } from '#app/infrastructure/database/user-auditable.entity';
import { User } from './user.entity';

@Entity({ name: 'hr_departments', comment: '組織部門' })
@Index('idx_hr_departments_parent_id', ['parentId'])
@Index('idx_hr_departments_start_date', ['startDate'])
@Index('idx_hr_departments_stop_date', ['stopDate'])
@Index('idx_hr_departments_created_at', ['createdAt'])
@Index('idx_hr_departments_updated_at', ['updatedAt'])
@Index('idx_hr_departments_deleted_at', ['deletedAt'])
export class Department extends UserAuditableEntity {
  @PrimaryGeneratedColumn({ type: 'bigint', comment: '部門流水號' })
  id!: number;

  @Column({
    name: 'department_name',
    type: 'varchar',
    length: 150,
    comment: '部門名稱',
  })
  departmentName!: string;

  @Column({
    name: 'parent_id',
    type: 'bigint',
    nullable: true,
    comment: '上層部門 ID',
  })
  parentId?: number;

  @ManyToOne(() => Department, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'parent_id',
    foreignKeyConstraintName: 'fk_hr_departments_parent',
  })
  parent?: Department;

  @Column({
    name: 'start_date',
    type: 'date',
    nullable: true,
    comment: '生效日',
  })
  startDate?: string;

  @Column({
    name: 'stop_date',
    type: 'date',
    nullable: true,
    comment: '停用日',
  })
  stopDate?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'fk_hr_departments_created_by_user',
  })
  createdByUser?: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'updated_by_user_id',
    foreignKeyConstraintName: 'fk_hr_departments_updated_by_user',
  })
  updatedByUser?: User;
}
