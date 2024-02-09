package api

import (
	"github.com/oscartbeaumont/forge/dominion/pkg/soap"
)

var LoginResponse struct {
}

// CheckIn creates a new device on the API
func (api *Service) CheckIn(deviceId string, cmd soap.EnrollmentRequest) error {
	// TODO: Do stuff

	return nil

}
