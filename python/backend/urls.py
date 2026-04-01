from django.urls import path

from api import views


urlpatterns = [
    path("api/health", views.health, name="health"),
    path("api/assemble", views.assemble_view, name="assemble"),
    path("api/run", views.run_view, name="run"),
    path("api/session/start", views.start_session_view, name="session-start"),
    path("api/session/input", views.input_view, name="session-input"),
]
