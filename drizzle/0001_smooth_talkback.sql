CREATE TYPE "public"."goal_category" AS ENUM('Health', 'Skill', 'Career', 'Personal Growth');--> statement-breakpoint
CREATE TYPE "public"."intervention_trigger" AS ENUM('Multiple Missed Routines', 'Broken Streak', 'Repeated Delays', 'Discipline Drop');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('Low', 'Medium', 'High');--> statement-breakpoint
CREATE TYPE "public"."routine_category" AS ENUM('Morning', 'Work', 'Study', 'Health & Fitness', 'Evening', 'Reflection');--> statement-breakpoint
CREATE TYPE "public"."routine_frequency" AS ENUM('Daily', 'Weekdays', 'Weekends', 'Weekly', 'Custom');--> statement-breakpoint
CREATE TYPE "public"."routine_log_status" AS ENUM('Completed', 'Delayed', 'Skipped');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(60) NOT NULL,
	"color" varchar(20) NOT NULL,
	CONSTRAINT "custom_categories_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drift_dismissals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"signal_id" varchar(120) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drift_dismissals_user_id_signal_id_unique" UNIQUE("user_id","signal_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "goal_category" NOT NULL,
	"target_date" varchar(10) NOT NULL,
	"priority" "priority" NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interventions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"trigger" "intervention_trigger" NOT NULL,
	"message" text NOT NULL,
	"action" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"dedupe_key" varchar(160) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "interventions_user_id_dedupe_key_unique" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reflections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"date" varchar(10) NOT NULL,
	"went_well" text NOT NULL,
	"mistakes" text NOT NULL,
	"learned" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routine_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"routine_id" integer NOT NULL,
	"date" varchar(10) NOT NULL,
	"status" "routine_log_status" NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "routine_logs_routine_id_date_unique" UNIQUE("routine_id","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routines" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"scheduled_time" varchar(5) NOT NULL,
	"category" "routine_category" NOT NULL,
	"frequency" "routine_frequency" NOT NULL,
	"priority" "priority" NOT NULL,
	"expected_duration_minutes" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vault_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"observation" text NOT NULL,
	"learning" text NOT NULL,
	"rule" text NOT NULL,
	"date" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category_budgets" DROP CONSTRAINT "category_budgets_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "finance_settings" DROP CONSTRAINT "finance_settings_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "reminders" DROP CONSTRAINT "reminders_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "savings_goals" DROP CONSTRAINT "savings_goals_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "category_budgets" ALTER COLUMN "category" SET DATA TYPE varchar(60);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "category" SET DATA TYPE varchar(60);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" varchar(255) NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "custom_categories" ADD CONSTRAINT "custom_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drift_dismissals" ADD CONSTRAINT "drift_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "interventions" ADD CONSTRAINT "interventions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reflections" ADD CONSTRAINT "reflections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "routine_logs" ADD CONSTRAINT "routine_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "routine_logs" ADD CONSTRAINT "routine_logs_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vault_entries" ADD CONSTRAINT "vault_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP TYPE "public"."expense_category";