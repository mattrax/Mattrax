package http_api

import (
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	mattrax "github.com/mattrax/Mattrax/internal"
	"github.com/mattrax/Mattrax/internal/db"
)

func Devices(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		GetAll: func(r *http.Request, DB *db.Queries, limit int32, offset int32) (interface{}, error) {
			vars := mux.Vars(r)

			devices, err := DB.GetDevices(r.Context(), db.GetDevicesParams{
				TenantID: vars["tenant"],
				Limit:    limit,
				Offset:   offset,
			})

			if devices == nil {
				devices = make([]db.GetDevicesRow, 0)
			}

			return devices, err
		},
	}.Handler(srv.DB)
}

func Device(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)

			return DB.GetDevice(r.Context(), db.GetDeviceParams{
				ID:       vars["udid"],
				TenantID: vars["tenant"],
			})
		},
		PatchType: func(r *http.Request) interface{} {
			return &db.Device{}
		},
		Patch: func(r *http.Request, DB *db.Queries, cmd interface{}) (interface{}, error) {
			vars := mux.Vars(r)
			device, ok := cmd.(*db.Device)
			if !ok {
				return nil, fmt.Errorf("invalid patch type. This error is a mistake made by a developer")
			}

			err := DB.UpdateDevice(r.Context(), db.UpdateDeviceParams{
				ID:       vars["udid"],
				TenantID: vars["tenant"],
				Name:     device.Name,
			})

			return nil, err
		},
	}.Handler(srv.DB)
}

func DeviceInformation(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)

			device, err := DB.GetDevice(r.Context(), db.GetDeviceParams{
				ID:       vars["udid"],
				TenantID: vars["tenant"],
			})

			return map[string]map[string]interface{}{
				"Device Information": {
					"Computer Name": device.Name,
					// "Serial Number":
				},
				"Software Information": {
					// "Operating System":         "Windows 10", // TODO
					// "Operating System Version": device.OperatingSystem,
				},
				"MDM": {
					// "Last Seen":        device.Lastseen,
					// "Last Seen Status": device.LastseenStatus,
				},
			}, err
		},
	}.Handler(srv.DB)
}

func DeviceScope(srv *mattrax.Server) http.HandlerFunc {
	return Endpoint{
		Get: func(r *http.Request, DB *db.Queries) (interface{}, error) {
			vars := mux.Vars(r)

			groups, err := DB.GetDeviceGroups(r.Context(), db.GetDeviceGroupsParams{
				DeviceID: vars["udid"],
				TenantID: vars["tenant"],
			})
			if err != nil {
				return nil, fmt.Errorf("error getting groups for device: %w", err)
			}

			if groups == nil {
				groups = make([]db.GetDeviceGroupsRow, 0)
			}

			policies, err := DB.GetDevicePolicies(r.Context(), vars["udid"])
			if err != nil {
				return nil, fmt.Errorf("error getting computed policies scoped to device: %w", err)
			}

			if policies == nil {
				policies = make([]db.GetDevicePoliciesRow, 0)
			}

			return map[string]interface{}{
				"groups":   groups,
				"policies": policies,
			}, nil
		},
	}.Handler(srv.DB)
}
