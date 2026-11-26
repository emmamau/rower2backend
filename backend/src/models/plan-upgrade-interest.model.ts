import { Sequelize, DataTypes, Model, ModelStatic } from "sequelize";

export interface PlanUpgradeInterestAttributes {
  id?: number;
  userId: string;
  targetPlan: string;
  sourceTrigger: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PlanUpgradeInterestModel = ModelStatic<Model<PlanUpgradeInterestAttributes>>;

export default (sequelize: Sequelize, _DataTypesInstance: typeof DataTypes): PlanUpgradeInterestModel => {
  const PlanUpgradeInterest = sequelize.define<Model<PlanUpgradeInterestAttributes>>(
    "PlanUpgradeInterest",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.STRING(64),
        field: "user_id",
        allowNull: false,
      },
      targetPlan: {
        type: DataTypes.STRING(32),
        field: "target_plan",
        allowNull: false,
      },
      sourceTrigger: {
        type: DataTypes.STRING(64),
        field: "source_trigger",
        defaultValue: "pioneer_modal",
      },
    },
    {
      tableName: "plan_upgrade_interests",
      timestamps: true,
      indexes: [
        { fields: ["user_id"] },
        { fields: ["target_plan"] },
        { fields: ["created_at"] },
      ],
    }
  );

  return PlanUpgradeInterest;
};
