from django.urls import path

from api import views


urlpatterns = [
    path("api/health", views.health, name="health"),
    path("api/assemble", views.assemble_view, name="assemble"),
    path("api/run", views.run_view, name="run"),
]
