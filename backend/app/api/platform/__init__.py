# Routes for the Platform (Super Admin Portal) sub-application —
# mounted at /api/v1/platform in app/main.py, structurally isolated
# from app/api/v1/ (see app/platform_app.py). Never import anything
# from app/api/v1/ here, or app/core/database.py's tenant-scoped
# get_db() — that defeats the whole point of the isolation.
