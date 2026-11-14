import uuid

from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.models import Device, Location


def main():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        location = db.scalar(select(Location).where(Location.name == "Totem de desenvolvimento"))
        if location is None:
            location = Location(
                name="Totem de desenvolvimento",
                description="Local interno para testes.",
                public_description="Local de teste",
                active=True,
            )
            db.add(location)
            db.flush()

        device = db.scalar(select(Device).where(Device.app_version == "dev-seed-1"))
        if device is None:
            device = Device(
                id=uuid.uuid4(),
                location_id=location.id,
                state="active",
                current_generation=0,
                app_version="dev-seed-1",
            )
            db.add(device)
        else:
            device.location_id = location.id
            device.state = "active"

        db.commit()
        print(f"DEVICE_ID={device.id}")
        print(f"LOCATION_ID={location.id}")
        print(f"GENERATION_ID={device.current_generation}")


if __name__ == "__main__":
    main()
