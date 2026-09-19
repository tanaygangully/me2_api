CREATE TYPE "public"."expense_category" AS ENUM('Food', 'Eggs', 'Travel', 'Social', 'Skincare', 'Bills', 'Haircut', 'Other');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('Cash', 'Card', 'UPI');--> statement-breakpoint
CREATE TYPE "public"."reminder_type" AS ENUM('Routine', 'Pre-Action', 'Missed Alert');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "category_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"category" "expense_category" NOT NULL,
	"budget" numeric(10, 2) NOT NULL,
	CONSTRAINT "category_budgets_user_id_category_unique" UNIQUE("user_id","category")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"daily_spend_cap" numeric(10, 2) DEFAULT '0' NOT NULL,
	"month_budget" numeric(10, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "finance_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"routine_name" varchar(160) NOT NULL,
	"type" "reminder_type" NOT NULL,
	"time" varchar(8) NOT NULL,
	"lead_minutes" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "savings_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" varchar(160) NOT NULL,
	"icon" varchar(80) NOT NULL,
	"color" varchar(20) NOT NULL,
	"target_amount" numeric(12, 2) NOT NULL,
	"saved_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"target_date" varchar(10) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" varchar(160) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"category" "expense_category" NOT NULL,
	"date" varchar(10) NOT NULL,
	"time" varchar(16) NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"paid_for_friend" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
