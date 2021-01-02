package android

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"cloud.google.com/go/pubsub"
	pubsub2 "cloud.google.com/go/pubsub"
	"github.com/mattrax/Mattrax/internal/db"
	"github.com/mattrax/Mattrax/pkg/null"
	"google.golang.org/api/androidmanagement/v1"
)

func recieve(p *Protocol) func(ctx context.Context, m *pubsub2.Message) {
	return func(ctx context.Context, m *pubsub.Message) {
		notificationType := m.Attributes["notificationType"]
		fmt.Println(notificationType, string(m.Data)) // TEMP
		if notificationType == "ENROLLMENT" {
			var device androidmanagement.Device
			if err := json.Unmarshal(m.Data, &device); err != nil {
				panic(err)
			}

			var tenantID = "UxQ03hJA"         // TODO: Work out using enrollment data thingo
			var userUPN = "admin@mattrax.app" // TODO: Work out using enrollment data thingo or device.userName

			tenant, err := p.srv.DB.GetTenant(ctx, tenantID)
			if err == sql.ErrNoRows {
				panic("Tenant not found")
				// span.Tag("warn", "tenant not found")
				// w.WriteHeader(http.StatusNotFound)
				// return
			} else if err != nil {
				panic(err)
				// log.Printf("[GetTenant Error]: %s\n", err)
				// span.Tag("err", fmt.Sprintf("error retrieving tenant: %s", err))
				// w.WriteHeader(http.StatusInternalServerError)
				// return
			}

			id, err := p.srv.DB.CreateDevice(ctx, db.CreateDeviceParams{
				TenantID: tenantID,
				Protocol: db.ManagementProtocolAndroid,
				Scope:    MattraxManagementScope(device.ManagementMode),
				State:    MattraxDeviceState(device.State),
				Udid:     device.Name,
				Name: null.String{
					String: device.HardwareInfo.SerialNumber,
					Valid:  true,
				},
				SerialNumber: null.String{
					String: device.HardwareInfo.SerialNumber,
					Valid:  true,
				},
				ModelManufacturer: null.String{
					String: device.HardwareInfo.Brand,
					Valid:  true,
				},
				Model: null.String{
					String: device.HardwareInfo.Model,
					Valid:  true,
				},
				OsMajor: null.String{
					String: device.SoftwareInfo.AndroidVersion,
					Valid:  true,
				},
				OsMinor: null.String{
					String: device.SoftwareInfo.AndroidBuildNumber,
					Valid:  true,
				},
				Owner: null.String{
					String: userUPN,
					Valid:  true,
				},
				Ownership: MattraxDeviceOwnership(device.Ownership),
			})
			if err != nil {
				panic(err)
			}

			policyName := fmt.Sprintf("enterprises/%s/policies/%s", tenant.AfwEnterpriseID.String, id)
			if _, err := p.ams.Enterprises.Policies.Patch(policyName, &androidmanagement.Policy{}).Do(); err != nil {
				panic(err)
			}

			if _, err := p.ams.Enterprises.Devices.Patch(device.Name, &androidmanagement.Device{
				PolicyName: policyName,
			}).UpdateMask("policyName").Do(); err != nil {
				panic(err)
			}
		} else if notificationType == "STATUS_REPORT" {
			var device androidmanagement.Device
			if err := json.Unmarshal(m.Data, &device); err != nil {
				panic(err)
			}

			mDevice, err := p.srv.DB.GetDeviceForManagement(ctx, device.Name)
			if err == sql.ErrNoRows {
				panic("Device not found")
				// span.Tag("warn", "tenant not found")
				// w.WriteHeader(http.StatusNotFound)
				// return
			} else if err != nil {
				panic(err)
				// log.Printf("[GetTenant Error]: %s\n", err)
				// span.Tag("err", fmt.Sprintf("error retrieving tenant: %s", err))
				// w.WriteHeader(http.StatusInternalServerError)
				// return
			}

			if AndroidDeviceState(mDevice.State) != device.State {
				fmt.Println("Updating device state to: ", device.State)
				// TODO
			}

			// TODO: Store last sync time, policyCompliant status
			// TODO: Unenroll status, Change device state to managed
		} else if notificationType == "COMMAND" {
			var op androidmanagement.Operation
			if err := json.Unmarshal(m.Data, &op); err != nil {
				panic(err)
			}

			fmt.Println(op)
		}

		m.Ack()
	}
}
