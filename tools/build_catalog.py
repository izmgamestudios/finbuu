# scripts/build_catalog.py
# Builds data/open-source-tools.json for Finbuu (girisimcaddesi.ortakofis.org)
import json, pathlib

GH = "https://github.com/"

def t(id, name, cat, license, osi, repo, website, docs, community, how, effect, tier, desc):
    stat, value = effect
    return {
        "id": id,
        "name": name,
        "category": cat,
        "description": desc,
        "license": license,
        "licenseType": osi,  # "osi" | "fair-code" | "source-available"
        "links": {
            "repo": repo,
            "website": website,
            "docs": docs,
            "community": community,
            "support": (repo + "/issues") if repo.startswith(GH) else repo,
        },
        "howToUse": how,
        "game": {
            "tier": tier,                         # 1=starter .. 4=enterprise
            "unlockLevel": [1, 3, 6, 10][tier - 1],
            "setupCost": [500, 1500, 4000, 10000][tier - 1],       # one-time coins (kurulum emeği)
            "monthlyHostingCost": [50, 150, 400, 1000][tier - 1],  # lisans 0, sunucu maliyeti var
            "effect": {"stat": stat, "value": value},
            "xpReward": [50, 120, 250, 500][tier - 1],
        },
    }

DOCKER = "Docker / docker compose ile kendi sunucuna kur (CloudPanel/Coolify da olur)"

tools = [
# ---------------- DEV / DEVOPS / BACKEND ----------------
t("gitea","Gitea","devops","MIT","osi",GH+"go-gitea/gitea","https://about.gitea.com","https://docs.gitea.com","https://forum.gitea.com",
  [DOCKER,"Admin hesabı aç, organizasyon ve repo oluştur","Gitea Actions ile CI/CD pipeline tanımla"],("employeeProductivity",0.05),2,
  "Hafif, self-hosted Git sunucusu (GitHub alternatifi)."),
t("gitlab-ce","GitLab CE","devops","MIT","osi","https://gitlab.com/gitlab-org/gitlab","https://about.gitlab.com","https://docs.gitlab.com","https://forum.gitlab.com",
  ["Omnibus paket veya Docker ile kur (min. 4 GB RAM)","Proje + issue board + merge request akışını kur",".gitlab-ci.yml ile pipeline yaz"],("employeeProductivity",0.08),3,
  "Git, CI/CD, issue ve wiki tek pakette DevOps platformu."),
t("coolify","Coolify","devops","Apache-2.0","osi",GH+"coollabsio/coolify","https://coolify.io","https://coolify.io/docs","https://coollabs.io/discord",
  ["Tek satır install script ile VPS'e kur","Git repo bağla, build pack seç (Nixpacks/Dockerfile)","Domain + otomatik SSL ver, deploy et"],("operatingCostReduction",0.05),2,
  "Heroku/Vercel benzeri self-hosted PaaS."),
t("portainer","Portainer CE","devops","Zlib","osi",GH+"portainer/portainer","https://www.portainer.io","https://docs.portainer.io",None,
  ["Portainer container'ını docker socket ile başlat","Admin şifresi belirle, local environment ekle","Container/stack'leri arayüzden yönet"],("securityLevel",0.03),1,
  "Docker/Kubernetes için web yönetim paneli."),
t("uptime-kuma","Uptime Kuma","devops","MIT","osi",GH+"louislam/uptime-kuma","https://uptime.kuma.pet",GH+"louislam/uptime-kuma/wiki",None,
  [DOCKER,"HTTP/TCP/ping monitor ekle","Telegram/Discord bildirim + public status page aç"],("customerRetention",0.03),1,
  "Site/servis uptime izleme ve status page."),
t("supabase","Supabase","backend","Apache-2.0","osi",GH+"supabase/supabase","https://supabase.com","https://supabase.com/docs","https://discord.supabase.com",
  ["Cloud'da proje aç veya docker compose ile self-host et","Tabloları oluştur, RLS policy yaz","supabase-js ile auth + realtime bağla"],("employeeProductivity",0.07),2,
  "PostgreSQL tabanlı Firebase alternatifi (auth, storage, realtime)."),
t("pocketbase","PocketBase","backend","MIT","osi",GH+"pocketbase/pocketbase","https://pocketbase.io","https://pocketbase.io/docs",GH+"pocketbase/pocketbase/discussions",
  ["Tek binary indir, ./pocketbase serve","Admin UI'dan collection + API rule tanımla","JS SDK ile frontend'e bağla"],("operatingCostReduction",0.04),1,
  "Tek dosyalık backend: SQLite + auth + realtime + dosya."),
t("appwrite","Appwrite","backend","BSD-3-Clause","osi",GH+"appwrite/appwrite","https://appwrite.io","https://appwrite.io/docs","https://appwrite.io/discord",
  [DOCKER,"Proje + platform (web) ekle","Auth, Database, Functions servislerini SDK ile kullan"],("employeeProductivity",0.06),2,
  "Self-hosted backend-as-a-service."),

# ---------------- 3D / DESIGN / GAME ----------------
t("blender","Blender","design-3d","GPL-2.0-or-later","osi","https://projects.blender.org/blender/blender","https://www.blender.org","https://docs.blender.org/manual/en/latest/","https://blenderartists.org",
  ["blender.org'dan indir, kur","Modelle → UV → materyal → render (Cycles/Eevee) akışını öğren","glTF olarak web/oyuna export et"],("brandReach",0.06),2,
  "3D modelleme, animasyon, render ve video kurgu."),
t("godot","Godot Engine","design-3d","MIT","osi",GH+"godotengine/godot","https://godotengine.org","https://docs.godotengine.org","https://forum.godotengine.org",
  ["Editörü indir (kurulum gerektirmez)","Scene/Node yapısını kur, GDScript yaz","HTML5/Web export ile tarayıcıda yayınla"],("xpGain",0.10),2,
  "2D/3D açık kaynak oyun motoru."),
t("krita","Krita","design-2d","GPL-3.0","osi","https://invent.kde.org/graphics/krita","https://krita.org","https://docs.krita.org","https://krita-artists.org",
  ["krita.org'dan indir","Fırça setleri ve katmanlarla dijital çizim yap","Animasyon timeline ile sprite üret"],("brandReach",0.04),1,
  "Dijital resim, illüstrasyon ve 2D animasyon."),
t("gimp","GIMP","design-2d","GPL-3.0-or-later","osi","https://gitlab.gnome.org/GNOME/gimp","https://www.gimp.org","https://docs.gimp.org","https://www.gimp.org/discuss.html",
  ["gimp.org'dan indir","Katman, maske ve seçim araçlarıyla fotoğraf düzenle","Web için export (WebP/PNG)"],("brandReach",0.03),1,
  "Photoshop alternatifi raster görüntü editörü."),
t("inkscape","Inkscape","design-2d","GPL-2.0-or-later","osi","https://gitlab.com/inkscape/inkscape","https://inkscape.org","https://inkscape.org/learn/","https://inkscape.org/community/",
  ["inkscape.org'dan indir","Logo/ikon vektör çiz","Plain SVG olarak export et"],("brandReach",0.03),1,
  "Vektör grafik editörü (Illustrator alternatifi)."),
t("penpot","Penpot","design-2d","MPL-2.0","osi",GH+"penpot/penpot","https://penpot.app","https://help.penpot.app","https://community.penpot.app",
  ["penpot.app'te ücretsiz hesap aç veya Docker ile self-host et","Component + design token ile UI tasarla","Inspect modundan CSS/SVG kodu al"],("conversionRate",0.04),1,
  "Figma alternatifi, açık standart tabanlı UI tasarım aracı."),
t("excalidraw","Excalidraw","design-2d","MIT","osi",GH+"excalidraw/excalidraw","https://excalidraw.com","https://plus.excalidraw.com/docs/sdk",None,
  ["excalidraw.com'u aç (kurulum yok)","Wireframe / mimari diyagram çiz","Live collaboration linki paylaş"],("employeeProductivity",0.02),1,
  "El çizimi görünümlü whiteboard ve diyagram aracı."),

# ---------------- CMS / WEB ----------------
t("wordpress","WordPress","cms","GPL-2.0-or-later","osi",GH+"WordPress/wordpress-develop","https://wordpress.org","https://developer.wordpress.org","https://wordpress.org/support/forums/",
  ["Hosting'e (CloudPanel WP template) kur","Tema + eklenti seç, sayfa oluştur","SEO + güvenlik eklentisi ekle, yedek al"],("brandReach",0.08),1,
  "Web'in ~%40'ını çalıştıran CMS."),
t("ghost","Ghost","cms","MIT","osi",GH+"TryGhost/Ghost","https://ghost.org","https://ghost.org/docs/","https://forum.ghost.org",
  ["Ghost-CLI veya Docker ile kur","Blog yazısı + newsletter aç","Ücretli üyelik (membership) tanımla"],("brandReach",0.06),1,
  "Blog + newsletter + üyelik platformu."),
t("strapi","Strapi","cms","MIT","osi",GH+"strapi/strapi","https://strapi.io","https://docs.strapi.io","https://forum.strapi.io",
  ["npx create-strapi@latest ile proje aç","Content-Type Builder ile model oluştur","REST/GraphQL API'yi frontend'e bağla"],("employeeProductivity",0.05),2,
  "Node.js headless CMS."),
t("payload","Payload CMS","cms","MIT","osi",GH+"payloadcms/payload","https://payloadcms.com","https://payloadcms.com/docs",GH+"payloadcms/payload/discussions",
  ["npx create-payload-app ile Next.js projesi aç","Collection config'leri TypeScript ile yaz","Admin paneli + Local API kullan"],("employeeProductivity",0.05),2,
  "Next.js native, TypeScript headless CMS."),
t("directus","Directus","cms","BSL-1.1","source-available",GH+"directus/directus","https://directus.com","https://directus.com/docs/","https://directus.chat",
  [DOCKER,"Mevcut SQL veritabanını bağla","Otomatik REST/GraphQL API + admin app kullan"],("employeeProductivity",0.05),2,
  "SQL veritabanını anında API + admin paneline çevirir. Not: BSL — gelir eşiği üstünde ticari lisans gerekir."),

# ---------------- CRM / CUSTOMER ----------------
t("twenty","Twenty CRM","crm","AGPL-3.0","osi",GH+"twentyhq/twenty","https://twenty.com","https://docs.twenty.com",GH+"twentyhq/twenty/discussions",
  [DOCKER,"Workspace aç, People/Companies/Opportunities kur","Custom object + API/webhook ile entegre et"],("customerRetention",0.08),2,
  "Modern, Salesforce alternatifi açık kaynak CRM."),
t("suitecrm","SuiteCRM","crm","AGPL-3.0","osi",GH+"salesagility/SuiteCRM-Core","https://suitecrm.com","https://docs.suitecrm.com","https://community.suitecrm.com",
  ["PHP/MySQL sunucuya kur","Lead → Opportunity → Quote akışını tanımla","Workflow ve rapor modüllerini aç"],("customerRetention",0.07),3,
  "Kurumsal seviye PHP CRM."),
t("espocrm","EspoCRM","crm","AGPL-3.0","osi",GH+"espocrm/espocrm","https://www.espocrm.com","https://docs.espocrm.com","https://forum.espocrm.com",
  ["Installer ile PHP sunucuya kur","Entity Manager ile alan ekle","E-posta hesabını bağla, satış pipeline'ını kur"],("customerRetention",0.06),2,
  "Hafif, hızlı, özelleştirilebilir CRM."),
t("krayin","Krayin CRM","crm","MIT","osi",GH+"krayin/laravel-crm","https://krayincrm.com","https://devdocs.krayincrm.com",None,
  ["composer create-project ile Laravel'e kur","Lead pipeline + aktiviteleri tanımla","Web form ile lead topla"],("customerRetention",0.05),1,
  "Laravel tabanlı KOBİ CRM."),
t("chatwoot","Chatwoot","crm","MIT","osi",GH+"chatwoot/chatwoot","https://www.chatwoot.com","https://www.chatwoot.com/docs",GH+"chatwoot/chatwoot/discussions",
  [DOCKER,"Website live-chat widget + WhatsApp/Instagram inbox bağla","Canned response ve otomasyon kuralları yaz"],("customerRetention",0.07),2,
  "Omnichannel müşteri destek (Intercom/Zendesk alternatifi)."),

# ---------------- ERP / OPERATIONS ----------------
t("erpnext","ERPNext","erp","GPL-3.0","osi",GH+"frappe/erpnext","https://frappe.io/erpnext","https://docs.erpnext.com","https://discuss.frappe.io",
  ["frappe_docker ile kur","Setup wizard: şirket, para birimi, hesap planı","Satış, stok, muhasebe, İK modüllerini aç"],("operatingCostReduction",0.10),4,
  "Tam kapsamlı ERP (muhasebe, stok, üretim, İK)."),
t("odoo","Odoo Community","erp","LGPL-3.0","osi",GH+"odoo/odoo","https://www.odoo.com","https://www.odoo.com/documentation/","https://www.odoo.com/forum",
  ["Docker image ile kur","İhtiyaç duyduğun app'leri (Satış, Envanter, Fatura) yükle","Python modül yazarak özelleştir"],("operatingCostReduction",0.10),4,
  "Modüler ERP/CRM paketi (Community sürümü açık kaynak)."),
t("dolibarr","Dolibarr","erp","GPL-3.0-or-later","osi",GH+"Dolibarr/dolibarr","https://www.dolibarr.org","https://wiki.dolibarr.org","https://www.dolibarr.org/forum",
  ["DoliWamp veya PHP sunucuya kur","Modülleri aç: Fatura, Teklif, Stok","Müşteri/tedarikçi kartlarını gir"],("operatingCostReduction",0.06),2,
  "KOBİ ve serbest çalışanlar için ERP/CRM."),
t("inventree","InvenTree","erp","MIT","osi",GH+"inventree/InvenTree","https://inventree.org","https://docs.inventree.org",GH+"inventree/InvenTree/discussions",
  [DOCKER,"Parça kategorileri + stok lokasyonları oluştur","Satın alma / satış siparişi akışını kullan"],("operatingCostReduction",0.04),2,
  "Envanter ve parça yönetimi."),
t("bookstack","BookStack","erp","MIT","osi",GH+"BookStackApp/BookStack","https://www.bookstackapp.com","https://www.bookstackapp.com/docs/",None,
  [DOCKER,"Shelf → Book → Chapter → Page yapısını kur","Şirket SOP ve onboarding dokümanlarını yaz"],("employeeProductivity",0.04),1,
  "Kurumsal wiki / bilgi bankası."),

# ---------------- KPI / BI / ANALYTICS ----------------
t("metabase","Metabase","analytics","AGPL-3.0","osi",GH+"metabase/metabase","https://www.metabase.com","https://www.metabase.com/docs/latest/","https://discourse.metabase.com",
  ["Docker ile kur, veritabanını bağla","Soru (question) oluştur, dashboard'a ekle","KPI alert ve e-posta abonelikleri kur"],("marketResearch",0.08),2,
  "Kod bilmeden SQL veriden KPI dashboard'ları."),
t("superset","Apache Superset","analytics","Apache-2.0","osi",GH+"apache/superset","https://superset.apache.org","https://superset.apache.org/docs/intro",GH+"apache/superset/discussions",
  ["docker compose ile kur","Database + dataset tanımla","Chart ve dashboard oluştur"],("marketResearch",0.10),3,
  "Kurumsal ölçekli BI ve görselleştirme."),
t("grafana","Grafana","analytics","AGPL-3.0","osi",GH+"grafana/grafana","https://grafana.com","https://grafana.com/docs/grafana/latest/","https://community.grafana.com",
  [DOCKER,"Prometheus/PostgreSQL data source ekle","Panel + alert kuralları oluştur"],("securityLevel",0.05),2,
  "Metrik, log ve KPI izleme dashboard'ları."),
t("plausible","Plausible CE","analytics","AGPL-3.0","osi",GH+"plausible/analytics","https://plausible.io","https://plausible.io/docs",GH+"plausible/analytics/discussions",
  ["community-edition repo ile docker compose kur","Siteni ekle, script tag'ini yapıştır","Goal/conversion event tanımla"],("marketResearch",0.05),1,
  "Çerezsiz, KVKK/GDPR dostu web analitiği."),
t("umami","Umami","analytics","MIT","osi",GH+"umami-software/umami","https://umami.is","https://umami.is/docs",None,
  [DOCKER,"Website ekle, tracking script'i yerleştir","Custom event ile buton tıklamalarını ölç"],("marketResearch",0.04),1,
  "Hafif, gizlilik odaklı web analitiği."),
t("matomo","Matomo","analytics","GPL-3.0","osi",GH+"matomo-org/matomo","https://matomo.org","https://matomo.org/docs/","https://forum.matomo.org",
  ["PHP/MySQL sunucuya kur","Tracking kodunu ekle","Funnel, heatmap ve hedef raporlarını incele"],("marketResearch",0.06),2,
  "Google Analytics alternatifi tam analitik."),
t("posthog","PostHog","analytics","MIT","osi",GH+"PostHog/posthog","https://posthog.com","https://posthog.com/docs","https://posthog.com/questions",
  ["Cloud ücretsiz katmanla başla (self-host hobby deploy da var)","posthog-js SDK ekle","Funnel, session replay, feature flag, A/B test kullan"],("conversionRate",0.08),3,
  "Ürün analitiği + feature flag + A/B test."),

# ---------------- SOCIAL MEDIA / MARKETING / COMMUNITY ----------------
t("postiz","Postiz","social","AGPL-3.0","osi",GH+"gitroomhq/postiz-app","https://postiz.com","https://docs.postiz.com",None,
  [DOCKER,"Sosyal hesapları (X, LinkedIn, IG…) bağla","Takvimden gönderi planla, AI ile içerik üret"],("brandReach",0.08),2,
  "Buffer/Hootsuite alternatifi sosyal medya planlayıcı."),
t("mixpost","Mixpost","social","MIT","osi",GH+"inovector/mixpost","https://mixpost.app","https://docs.mixpost.app",None,
  ["Laravel paketi veya Docker ile kur","Hesapları bağla, post takvimi oluştur","Analitik ekranından performansı izle"],("brandReach",0.06),1,
  "Self-hosted sosyal medya yönetimi (Lite sürümü MIT)."),
t("mautic","Mautic","social","GPL-3.0","osi",GH+"mautic/mautic","https://www.mautic.org","https://docs.mautic.org","https://forum.mautic.org",
  ["PHP sunucuya kur","Segment + form + landing page oluştur","Campaign builder ile otomasyon akışı kur"],("conversionRate",0.08),3,
  "Pazarlama otomasyonu (HubSpot Marketing alternatifi)."),
t("listmonk","Listmonk","social","AGPL-3.0","osi",GH+"knadh/listmonk","https://listmonk.app","https://listmonk.app/docs/",None,
  ["Tek binary veya Docker ile kur","SMTP (SES/Mailgun) bağla, liste oluştur","Template + kampanya gönder"],("customerRetention",0.05),1,
  "Yüksek performanslı newsletter / e-posta kampanya aracı."),
t("mastodon","Mastodon","social","AGPL-3.0","osi",GH+"mastodon/mastodon","https://joinmastodon.org","https://docs.joinmastodon.org",None,
  ["Var olan bir sunucuya katıl veya kendi instance'ını kur","Profil + topluluk kuralları oluştur","Fediverse'de takipçi kitlesi büyüt"],("brandReach",0.05),3,
  "Merkeziyetsiz sosyal ağ (Fediverse)."),
t("discourse","Discourse","social","GPL-2.0","osi",GH+"discourse/discourse","https://www.discourse.org","https://meta.discourse.org/docs","https://meta.discourse.org",
  ["discourse_docker ile kur","Kategori + trust level + rozet ayarla","SSO ile kendi uygulamana bağla"],("customerRetention",0.07),2,
  "Topluluk forumu; trust level ve rozet sistemiyle gamification."),

# ---------------- E-COMMERCE ----------------
t("woocommerce","WooCommerce","ecommerce","GPL-3.0","osi",GH+"woocommerce/woocommerce","https://woocommerce.com","https://woocommerce.com/documentation/","https://wordpress.org/support/plugin/woocommerce/",
  ["WordPress'e eklenti olarak kur","Ürün, kargo, vergi ayarla","Ödeme sağlayıcı (iyzico/PayTR eklentisi) bağla"],("onlineSalesChannel",1),1,
  "WordPress üzerinde e-ticaret."),
t("medusa","Medusa","ecommerce","MIT","osi",GH+"medusajs/medusa","https://medusajs.com","https://docs.medusajs.com",GH+"medusajs/medusa/discussions",
  ["npx create-medusa-app ile kur","Region, ürün, fiyat listesi tanımla","Next.js storefront starter bağla"],("onlineSalesChannel",1),2,
  "Node.js headless commerce."),
t("saleor","Saleor","ecommerce","BSD-3-Clause","osi",GH+"saleor/saleor","https://saleor.io","https://docs.saleor.io",GH+"saleor/saleor/discussions",
  ["saleor-platform docker compose ile kur","Dashboard'dan kanal + ürün tipi tanımla","GraphQL API ile storefront geliştir"],("onlineSalesChannel",1),3,
  "GraphQL-first, kurumsal headless e-ticaret."),
t("prestashop","PrestaShop","ecommerce","OSL-3.0","osi",GH+"PrestaShop/PrestaShop","https://www.prestashop.com","https://devdocs.prestashop-project.org","https://www.prestashop-project.org",
  ["PHP sunucuya installer ile kur","Tema + modül seç","Ürün kataloğu ve ödeme modüllerini ayarla"],("onlineSalesChannel",1),2,
  "Avrupa'da yaygın PHP e-ticaret platformu."),
t("bagisto","Bagisto","ecommerce","MIT","osi",GH+"bagisto/bagisto","https://bagisto.com","https://devdocs.bagisto.com",None,
  ["composer create-project bagisto/bagisto","Kanal, para birimi, ürün ekle","Multi-vendor marketplace eklentisini değerlendir"],("onlineSalesChannel",1),2,
  "Laravel tabanlı e-ticaret ve marketplace."),

# ---------------- AI ----------------
t("ollama","Ollama","ai","MIT","osi",GH+"ollama/ollama","https://ollama.com","https://docs.ollama.com","https://discord.gg/ollama",
  ["ollama.com'dan kur","ollama run llama3.2 ile model çalıştır","localhost:11434 REST API'yi uygulamana bağla"],("employeeProductivity",0.10),2,
  "Açık modelleri (Llama, Qwen, Gemma…) lokalde çalıştırma."),
t("open-webui","Open WebUI","ai","BSD-3-Clause + branding clause","source-available",GH+"open-webui/open-webui","https://openwebui.com","https://docs.openwebui.com",None,
  [DOCKER,"Ollama veya OpenAI uyumlu API bağla","Ekip için kullanıcı + RAG doküman kütüphanesi aç"],("employeeProductivity",0.08),2,
  "ChatGPT benzeri self-hosted AI arayüzü. Not: v0.6.6+ lisansında marka koruma maddesi var."),
t("dify","Dify","ai","Dify Open Source License (Apache-2.0 + conditions)","source-available",GH+"langgenius/dify","https://dify.ai","https://docs.dify.ai",GH+"langgenius/dify/discussions",
  [DOCKER,"Model sağlayıcı ekle","Workflow / chatbot / agent oluştur, API olarak yayınla"],("employeeProductivity",0.10),3,
  "LLM uygulama ve agent geliştirme platformu. Not: multi-tenant SaaS için ek koşullar."),
t("flowise","Flowise","ai","Apache-2.0","osi",GH+"FlowiseAI/Flowise","https://flowiseai.com","https://docs.flowiseai.com",None,
  ["npx flowise start veya Docker","Sürükle-bırak ile chatflow oluştur","Embed widget ile siteye ekle"],("employeeProductivity",0.07),2,
  "Görsel LLM / agent akış oluşturucu."),
t("langchain","LangChain","ai","MIT","osi",GH+"langchain-ai/langchain","https://www.langchain.com","https://docs.langchain.com",None,
  ["pip install langchain (veya npm i langchain)","Model + prompt + tool zinciri kur","LangGraph ile agent akışı tasarla"],("employeeProductivity",0.08),3,
  "LLM uygulama geliştirme framework'ü (Python/JS)."),
t("comfyui","ComfyUI","ai","GPL-3.0","osi",GH+"comfyanonymous/ComfyUI","https://www.comfy.org","https://docs.comfy.org",None,
  ["Desktop sürümünü indir veya repo'dan kur (GPU önerilir)","Node tabanlı görsel üretim workflow'u kur","Workflow'u API olarak çağır"],("brandReach",0.07),3,
  "Node tabanlı görsel/video üretim (Stable Diffusion, Flux)."),
t("anythingllm","AnythingLLM","ai","MIT","osi",GH+"Mintplex-Labs/anything-llm","https://anythingllm.com","https://docs.anythingllm.com",None,
  ["Desktop uygulamasını veya Docker'ı kur","Workspace aç, PDF/doküman yükle","Şirket dokümanlarıyla RAG sohbet et"],("marketResearch",0.06),1,
  "Doküman tabanlı özel AI asistanı (RAG)."),
t("localai","LocalAI","ai","MIT","osi",GH+"mudler/LocalAI","https://localai.io","https://localai.io/docs/",None,
  [DOCKER,"Model galerisinden model yükle","OpenAI uyumlu endpoint'i mevcut kodda kullan"],("operatingCostReduction",0.06),3,
  "OpenAI API uyumlu self-hosted model sunucusu."),

# ---------------- AUTOMATION ----------------
t("n8n","n8n","automation","Sustainable Use License","fair-code",GH+"n8n-io/n8n","https://n8n.io","https://docs.n8n.io","https://community.n8n.io",
  [DOCKER,"Trigger (webhook/cron) + node'larla workflow kur","AI Agent node ile otomasyona LLM ekle"],("operatingCostReduction",0.08),2,
  "Zapier alternatifi workflow otomasyonu. Not: fair-code — iç kullanım serbest, SaaS olarak yeniden satış kısıtlı."),
t("activepieces","Activepieces","automation","MIT","osi",GH+"activepieces/activepieces","https://www.activepieces.com","https://www.activepieces.com/docs",None,
  [DOCKER,"Flow oluştur, trigger seç","Hazır 'piece' entegrasyonlarıyla adımları ekle"],("operatingCostReduction",0.06),1,
  "No-code otomasyon (Community Edition MIT)."),
t("node-red","Node-RED","automation","Apache-2.0","osi",GH+"node-red/node-red","https://nodered.org","https://nodered.org/docs/","https://discourse.nodered.org",
  ["npm install -g node-red && node-red","Tarayıcıda flow editor'ü aç","IoT/HTTP/MQTT node'larıyla akış kur"],("operatingCostReduction",0.04),1,
  "Akış tabanlı programlama (IoT ve entegrasyon)."),

# ---------------- COLLABORATION / PRODUCTIVITY ----------------
t("nextcloud","Nextcloud","productivity","AGPL-3.0","osi",GH+"nextcloud/server","https://nextcloud.com","https://docs.nextcloud.com","https://help.nextcloud.com",
  ["AIO Docker image ile kur","Dosya, takvim, kişiler, Talk uygulamalarını aç","Ekip klasörleri ve paylaşımları tanımla"],("employeeProductivity",0.07),2,
  "Google Workspace alternatifi dosya + işbirliği."),
t("mattermost","Mattermost","productivity","AGPL-3.0 (server) / Apache-2.0","osi",GH+"mattermost/mattermost","https://mattermost.com","https://docs.mattermost.com","https://forum.mattermost.com",
  [DOCKER,"Team + kanal oluştur","Webhook/bot ile CI ve sistem bildirimlerini bağla"],("employeeProductivity",0.06),2,
  "Slack alternatifi ekip sohbeti."),
t("plane","Plane","productivity","AGPL-3.0","osi",GH+"makeplane/plane","https://plane.so","https://docs.plane.so",None,
  [DOCKER,"Proje + cycle (sprint) + module oluştur","Issue'ları board/list/gantt görünümünde yönet"],("employeeProductivity",0.07),2,
  "Jira/Linear alternatifi proje ve sprint yönetimi."),
t("appflowy","AppFlowy","productivity","AGPL-3.0","osi",GH+"AppFlowy-IO/AppFlowy","https://appflowy.com","https://docs.appflowy.io",None,
  ["Desktop/mobil uygulamayı indir","Doküman + database + kanban sayfaları oluştur","AppFlowy Cloud ile self-host senkron kur"],("employeeProductivity",0.05),1,
  "Notion alternatifi."),
t("calcom","Cal.com","productivity","AGPL-3.0","osi",GH+"calcom/cal.com","https://cal.com","https://cal.com/docs",None,
  ["cal.com'da hesap aç veya Docker ile self-host et","Event type (toplantı türü) tanımla","Takvimi bağla, booking linkini paylaş"],("conversionRate",0.05),1,
  "Calendly alternatifi randevu planlama."),
t("documenso","Documenso","productivity","AGPL-3.0","osi",GH+"documenso/documenso","https://documenso.com","https://docs.documenso.com",None,
  [DOCKER,"PDF yükle, imza alanı ekle","Alıcılara gönder, imza durumunu takip et"],("conversionRate",0.04),2,
  "DocuSign alternatifi e-imza."),
]

ids = [x["id"] for x in tools]
assert len(ids) == len(set(ids)), "duplicate id"

catalog = {
    "version": "2026-11-20",
    "categories": {
        "devops": "Geliştirme & DevOps", "backend": "Backend / BaaS", "design-3d": "3D & Oyun",
        "design-2d": "2D Tasarım & UI", "cms": "CMS & Web", "crm": "CRM & Müşteri",
        "erp": "ERP & Operasyon", "analytics": "KPI, BI & Analitik", "social": "Sosyal Medya & Pazarlama",
        "ecommerce": "E-Ticaret", "ai": "Yapay Zeka", "automation": "Otomasyon", "productivity": "İşbirliği & Verimlilik",
    },
    "effectStats": {
        "employeeProductivity": "Çalışan verimliliği (+%)", "operatingCostReduction": "Operasyon gideri düşüşü (-%)",
        "customerRetention": "Müşteri sadakati (+%)", "conversionRate": "Satışa dönüşüm (+%)",
        "marketResearch": "Pazar araştırması gücü (+%)", "brandReach": "Marka erişimi (+%)",
        "securityLevel": "Siber saldırı direnci (+%)", "onlineSalesChannel": "Online satış kanalını açar (1=açık)",
        "xpGain": "Oyuncu XP kazanımı (+%)",
    },
    "tools": tools,
}

out = pathlib.Path(__file__).resolve().parent.parent / "data" / "open-source-tools.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
print(len(tools), "tools written ->", out)
