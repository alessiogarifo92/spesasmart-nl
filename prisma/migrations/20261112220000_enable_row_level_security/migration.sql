-- Hosted PostgreSQL services (Supabase) expose the public schema through an HTTP
-- data API to low-privilege roles. Row level security without any policy closes
-- every table to those roles. The app connects as the tables' owner, which row
-- level security does not apply to, so nothing changes for it.
ALTER TABLE "retailers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_matches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingestion_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shopping_lists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shopping_list_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
